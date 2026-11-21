import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parsePack, type Question } from '../shared/pack.ts'

export function listPacks(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[packs] could not read pack directory "${dir}":`, err)
    }
    return []
  }
}

export function packSizes(dir: string, names: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const name of names) {
    try {
      out[name] = loadPack(dir, name).questions.length
    } catch {
      out[name] = 0
    }
  }
  return out
}

export function loadPack(dir: string, name: string): { questions: Question[]; errors: string[] } {
  if (name !== basename(name)) {
    throw new Error(`pack "${name}" resolves outside the pack directory`)
  }
  const pack = parsePack(readFileSync(join(dir, name), 'utf8'))
  for (const q of pack.questions) {
    if (q.image && !existsSync(join(dir, q.image))) {
      pack.errors.push(`image "${q.image}" not found in the pack directory`)
    }
  }
  return pack
}
