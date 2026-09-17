import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { validBatchId } from './batches.ts'

type ReportStatus = 'acknowledged' | 'ready' | 'blocked'
const REPORT = new Set<ReportStatus>(['acknowledged', 'ready', 'blocked'])
const DEFAULT_ROOT = fileURLToPath(new URL('../../.review/batches/', import.meta.url))

export async function reportBatch(
  root: string,
  batchId: string,
  status: string,
  message?: string,
): Promise<void> {
  if (!validBatchId(batchId)) throw new Error('invalid batch id')
  if (!REPORT.has(status as ReportStatus)) throw new Error('invalid report status')
  const path = join(root, batchId, 'status.json')
  const current = JSON.parse(await readFile(path, 'utf8')) as { batchId: string; status: string }
  if (current.batchId !== batchId) throw new Error('status belongs to another batch')
  if (!['submitted', 'acknowledged', 'ready', 'blocked'].includes(current.status)) {
    throw new Error(`cannot report ${status} from ${current.status}`)
  }
  await writeFile(path, `${JSON.stringify({ batchId, status, ...(message ? { message } : {}) }, null, 2)}\n`)
}

async function main() {
  const [, , batchId = '', status = '', summaryPath] = process.argv
  const message = summaryPath ? (await readFile(summaryPath, 'utf8')).trim() : undefined
  await reportBatch(DEFAULT_ROOT, batchId, status, message)
  console.log(`Review batch ${batchId}: ${status}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
