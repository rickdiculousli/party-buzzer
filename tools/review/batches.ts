import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Annotation } from '../../client/review/model.ts'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type BatchInput = {
  threadId: string
  annotations: Annotation[]
  sourceRevision: string
  changedFiles: string[]
}

export type Batch = { id: string; dir: string; requestPath: string }

export type BatchDeps = {
  root: string
  id?: () => string
  capture: (dir: string) => Promise<Record<string, string>>
  currentRevision?: () => Promise<string>
}

function requestMarkdown(id: string, dir: string, input: BatchInput, captures: Record<string, string>): string {
  const notes = input.annotations.map((note, index) => {
    const key = `${note.surface}:${note.scenarioId}:${note.playerId ?? ''}`
    const image = captures[key]
    return [
      `## Suggestion ${index + 1}`,
      '',
      `- Preview: ${note.surface} / ${note.scenarioId}${note.playerId ? ` / ${note.playerId}` : ''}`,
      `- Target: ${note.targetId ?? note.targetText ?? 'selected region'}`,
      image ? `- Screenshot: ${resolve(join(dir, image))}` : '',
      '',
      note.text || '(No text supplied; inspect the selected target and screenshot.)',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  const changed = input.changedFiles.length ? input.changedFiles.map((line) => `- ${line}`).join('\n') : '- Clean at submission'
  return `# Review batch ${id}

Continue in this existing conversation. Read AGENTS.md, preserve unrelated working-tree changes, and implement the suggestions below. Validate affected behavior and report what changed.

After reading this batch, run:

\`node tools/review/report.ts ${id} acknowledged\`

When the work is ready for review, write a concise summary to a temporary file and run:

\`node tools/review/report.ts ${id} ready /absolute/path/to/summary.txt\`

If work cannot continue, use \`blocked\` instead of \`ready\` and provide the reason in the summary file.

Source revision: ${input.sourceRevision}

Working tree at submission:

${changed}

${notes}
`
}

export async function createBatch(input: BatchInput, deps: BatchDeps): Promise<Batch> {
  const id = (deps.id ?? randomUUID)()
  if (!ID.test(id)) throw new Error('invalid batch id')
  await mkdir(deps.root, { recursive: true })
  const dir = join(deps.root, id)
  const staging = join(deps.root, `.${id}.staging`)
  try {
    await access(dir)
    throw new Error(`batch ${id} already exists`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(staging)
  try {
    const captures = await deps.capture(staging)
    if (deps.currentRevision && await deps.currentRevision() !== input.sourceRevision) {
      throw new Error('source changed during capture; refresh the previews and submit again')
    }
    const manifest = { version: 1, id, ...input, captures }
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(staging, 'request.md'), requestMarkdown(id, dir, input, captures))
    await rename(staging, dir)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { id, dir, requestPath: join(dir, 'request.md') }
}

export function validBatchId(id: string): boolean {
  return ID.test(id)
}
