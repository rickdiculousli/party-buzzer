import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { sanitizeBlocks } from './setlist.ts'
import { knownModule } from './modes/index.ts'
import { duelRule } from './duel.ts'
import { isMinigameId, type SetlistBlock } from '../shared/protocol.ts'

const rule = (id: string) => !!duelRule(id)
const game = (id: string) => knownModule(id) || isMinigameId(id)

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

export function readSetlist(dir: string, name: string): SetlistBlock[] {
  guard(name)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  } catch (err) {
    console.warn(`[setlists] could not read "${name}":`, err)
    return []
  }
  return sanitizeBlocks(raw, game, rule)
}

export function writeSetlist(dir: string, name: string, blocks: SetlistBlock[]): string {
  const stem = name.trim().toLowerCase().replace(/\.json$/, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!stem) throw new Error('setlist name is empty')
  guard(name)
  const file = `${stem}.json`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), `${JSON.stringify(blocks, null, 2)}\n`)
  return file
}

function guard(name: string): void {
  if (name !== basename(name)) {
    throw new Error(`setlist "${name}" resolves outside the setlist directory`)
  }
}
