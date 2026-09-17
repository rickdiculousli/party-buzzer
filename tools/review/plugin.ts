import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { Annotation } from '../../client/review/model.ts'
import { createBatch, validBatchId } from './batches.ts'
import { capturePreviews } from './capture.ts'
import { QueueDeliveryError, queueBatch } from './codex.ts'
import { makeReviewScenarios } from './fixtures.ts'

const run = promisify(execFile)
const REPO = fileURLToPath(new URL('../../', import.meta.url))
const BATCH_ROOT = join(REPO, '.review', 'batches')

export class SubmissionGate {
  private pending = new Map<string, Promise<unknown>>()

  run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(id)
    if (existing) return existing as Promise<T>
    const started = work()
    this.pending.set(id, started)
    return started
  }
}

const submissions = new SubmissionGate()

export type DeliveryRecord = {
  batchId: string
  status: 'submitting' | 'submitted' | 'delivery-uncertain' | 'delivery-failed' | 'acknowledged' | 'ready' | 'blocked'
  message?: string
}

function reply(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 1_000_000) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`
}

async function statusOf(batchId: string): Promise<DeliveryRecord> {
  return JSON.parse(await readFile(join(BATCH_ROOT, batchId, 'status.json'), 'utf8')) as DeliveryRecord
}

async function writeStatus(dir: string, record: DeliveryRecord): Promise<DeliveryRecord> {
  await writeFile(join(dir, 'status.json'), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export async function markSubmitted(dir: string, batchId: string): Promise<DeliveryRecord> {
  const current = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8')) as DeliveryRecord
  if (current.batchId !== batchId) throw new Error('status belongs to another batch')
  if (current.status !== 'submitting') return current
  return writeStatus(dir, { batchId, status: 'submitted' })
}

async function submit(input: {
  batchId: string
  threadId: string
  annotations: Annotation[]
  baseUrl: string
}): Promise<DeliveryRecord> {
  const readRevision = async () => (await run('git', ['rev-parse', 'HEAD'], { cwd: REPO })).stdout.trim()
  const revision = await readRevision()
  const { stdout: changes } = await run('git', ['status', '--short'], { cwd: REPO })
  const batch = await createBatch(
    {
      threadId: input.threadId,
      annotations: input.annotations,
      sourceRevision: revision,
      changedFiles: changes.trim() ? changes.trimEnd().split('\n') : [],
    },
    {
      root: BATCH_ROOT,
      id: () => input.batchId,
      capture: (dir) => capturePreviews(input.baseUrl, input.annotations, dir),
      currentRevision: readRevision,
    },
  )
  await writeStatus(batch.dir, { batchId: batch.id, status: 'submitting' })
  if (!input.threadId) return writeStatus(batch.dir, { batchId: batch.id, status: 'submitted' })
  try {
    await queueBatch({
      threadId: input.threadId,
      cwd: REPO,
      batchId: batch.id,
      requestPath: batch.requestPath,
    })
    return await markSubmitted(batch.dir, batch.id)
  } catch (error) {
    const uncertain = error instanceof QueueDeliveryError && error.reason === 'timeout'
    return await writeStatus(batch.dir, {
      batchId: batch.id,
      status: uncertain ? 'delivery-uncertain' : 'delivery-failed',
      message: (error as Error).message,
    })
  }
}

export function reviewPlugin(): Plugin {
  return {
    name: 'review-workbench',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__review/scenarios', (req, res) => {
        if (req.method !== 'GET') return reply(res, 405, { error: 'GET only' })
        reply(res, 200, { scenarios: makeReviewScenarios() })
      })

      server.middlewares.use('/__review/session', (req, res) => {
        if (req.method !== 'GET') return reply(res, 405, { error: 'GET only' })
        const threadId = process.env.CODEX_THREAD_ID ?? ''
        reply(res, 200, {
          threadId,
          delivery: threadId ? 'codex' : 'clipboard',
          batchRoot: BATCH_ROOT,
        })
      })

      server.middlewares.use('/__review/batches', async (req, res) => {
        if (!sameOrigin(req)) return reply(res, 403, { error: 'same origin required' })
        const batchId = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (req.method === 'GET') {
          if (!validBatchId(batchId)) return reply(res, 400, { error: 'invalid batch id' })
          try {
            return reply(res, 200, await statusOf(batchId))
          } catch {
            return reply(res, 404, { error: 'batch not found' })
          }
        }
        if (req.method !== 'POST' || batchId) return reply(res, 405, { error: 'POST collection or GET batch' })
        try {
          const data = await bodyOf(req) as {
            batchId?: unknown; threadId?: unknown; annotations?: unknown
          }
          const id = String(data.batchId ?? '')
          const threadId = String(data.threadId ?? '')
          if (!validBatchId(id)) return reply(res, 400, { error: 'invalid batch id' })
          if (threadId.length > 200) return reply(res, 400, { error: 'invalid thread id' })
          if (!Array.isArray(data.annotations) || data.annotations.length === 0) {
            return reply(res, 400, { error: 'at least one annotation is required' })
          }
          const work = submissions.run(id, async () => {
            try {
              return await statusOf(id)
            } catch {
              return submit({
                batchId: id,
                threadId,
                annotations: data.annotations as Annotation[],
                baseUrl: `http://${req.headers.host}`,
              })
            }
          })
          reply(res, 200, await work)
        } catch (error) {
          reply(res, 500, { error: (error as Error).message })
        }
      })
    },
  }
}
