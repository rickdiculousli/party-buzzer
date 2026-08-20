/**
 * Saved setlists on disk. Mirrors packs.ts — filenames in State, content on the
 * box — with the one thing packs never needed: a writer. A setlist is small, rare
 * and host-authored, so it is a whole-file JSON write.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sanitizeBlocks } from './setlist.ts'
import { knownModule } from './modes/index.ts'
import { duelRule } from './duel.ts'
import type { SetlistBlock } from '../shared/protocol.ts'

const rule = (id: string) => !!duelRule(id)

/** Sorted setlist filenames. A missing directory is a room with nothing saved. */
export function listSetlists(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[setlists] could not read setlist directory "${dir}":`, err)
    }
    return []
  }
}

/**
 * The blocks in a saved setlist, coerced to what this build can run. A file that
 * is missing, malformed, or written by another build reads as a setlist rather
 * than throwing — the host picked a name off a list and deserves an answer.
 */
export function readSetlist(dir: string, name: string): SetlistBlock[] {
  guard(name)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  } catch (err) {
    console.warn(`[setlists] could not read "${name}":`, err)
    return []
  }
  return sanitizeBlocks(raw, knownModule, rule)
}

/** Write a setlist, returning the filename it landed under. */
export function writeSetlist(dir: string, name: string, blocks: SetlistBlock[]): string {
  // The extension follows from the format rather than from what the host typed,
  // so a setlist saved as "night.txt" is still a readable .json on the next boot.
  const stem = name.trim().toLowerCase().replace(/\.json$/, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!stem) throw new Error('setlist name is empty')
  guard(name)
  const file = `${stem}.json`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), `${JSON.stringify(blocks, null, 2)}\n`)
  return file
}

/** The name arrives from a host message: untrusted input naming a path. */
function guard(name: string): void {
  if (name !== basename(name)) {
    throw new Error(`setlist "${name}" resolves outside the setlist directory`)
  }
}
