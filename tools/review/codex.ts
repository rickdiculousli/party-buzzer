export type ProcessResult = {
  status: 'ok' | 'missing-binary' | 'timeout' | 'failed'
  stdout: string
  stderr: string
  exitCode?: number
}

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<ProcessResult>

export type QueueBatchInput = {
  threadId: string
  cwd: string
  batchId: string
  requestPath: string
}

export class QueueDeliveryError extends Error {
  readonly reason: Exclude<ProcessResult['status'], 'ok'>

  constructor(
    reason: Exclude<ProcessResult['status'], 'ok'>,
    detail: string,
  ) {
    super(`Codex delivery ${reason}: ${detail || 'no diagnostic output'}`)
    this.name = 'QueueDeliveryError'
    this.reason = reason
  }
}

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const append = (current: string, chunk: Buffer | string) =>
      (current + chunk.toString()).slice(0, DIAGNOSTIC_LIMIT)
    const finish = (result: ProcessResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        status: error.code === 'ENOENT' ? 'missing-binary' : 'failed',
        stdout,
        stderr: append(stderr, error.message),
      })
    })
    child.on('close', (exitCode) => {
      if (timedOut) finish({ status: 'timeout', stdout, stderr, exitCode: exitCode ?? undefined })
      else if (exitCode === 0) finish({ status: 'ok', stdout, stderr, exitCode })
      else finish({ status: 'failed', stdout, stderr, exitCode: exitCode ?? undefined })
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
  })

export async function queueBatch(input: QueueBatchInput, run: ProcessRunner = runProcess): Promise<void> {
  const result = await run(
    'codex',
    [
      'queue',
      '--thread',
      input.threadId,
      '--message',
      `Review batch ${input.batchId}. Read ${input.requestPath}.`,
    ],
    { cwd: input.cwd, timeoutMs: 10_000 },
  )
  if (result.status !== 'ok') {
    throw new QueueDeliveryError(result.status, result.stderr || result.stdout)
  }
}
import { spawn } from 'node:child_process'

const DIAGNOSTIC_LIMIT = 2_000
