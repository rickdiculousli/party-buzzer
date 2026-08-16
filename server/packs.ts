/**
 * Packs on disk. The server holds question content in memory while reading and
 * never puts it in `State` — only spoken fragments go there.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parsePack, type Question } from '../shared/pack.ts'

/** Sorted pack filenames. A missing directory is a room with no packs, not an error. */
export function listPacks(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort()
  } catch {
    return []
  }
}

export function loadPack(dir: string, name: string): { questions: Question[]; errors: string[] } {
  // The name arrives from a host message, so it is untrusted input naming a
  // path. A name that is not already its own basename is trying to traverse.
  if (name !== basename(name)) {
    throw new Error(`pack "${name}" resolves outside the pack directory`)
  }
  return parsePack(readFileSync(join(dir, name), 'utf8'))
}
