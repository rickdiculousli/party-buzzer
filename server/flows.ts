/**
 * Saved flows on disk. Mirrors packs.ts — filenames in State, content on the
 * box — with the one thing packs never needed: a writer. A flow is small, rare
 * and host-authored, so it is a whole-file JSON write.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sanitizeBlocks } from './flow.ts'
import { knownModule } from './modes/index.ts'
import { duelRule } from './duel.ts'
import type { FlowBlock } from '../shared/protocol.ts'

const known = (id: string) => knownModule(id)
const rule = (id: string) => !!duelRule(id)

/** Sorted flow filenames. A missing directory is a room with nothing saved. */
export function listFlows(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[flows] could not read flow directory "${dir}":`, err)
    }
    return []
  }
}

/**
 * The blocks in a saved flow, coerced to what this build can run. A file that
 * is missing, malformed, or written by another build reads as a setlist rather
 * than throwing — the host picked a name off a list and deserves an answer.
 */
export function readFlow(dir: string, name: string): FlowBlock[] {
  guard(name)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  } catch (err) {
    console.warn(`[flows] could not read "${name}":`, err)
    return []
  }
  return sanitizeBlocks(raw, known, rule)
}

/** Write a flow, returning the filename it landed under. */
export function writeFlow(dir: string, name: string, blocks: FlowBlock[]): string {
  // The extension follows from the format rather than from what the host typed,
  // so a flow saved as "night.txt" is still a readable .json on the next boot.
  const stem = name.trim().toLowerCase().replace(/\.json$/, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!stem) throw new Error('flow name is empty')
  guard(name)
  const file = `${stem}.json`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), `${JSON.stringify(blocks, null, 2)}\n`)
  return file
}

/** The name arrives from a host message: untrusted input naming a path. */
function guard(name: string): void {
  if (name !== basename(name)) {
    throw new Error(`flow "${name}" resolves outside the flow directory`)
  }
}
