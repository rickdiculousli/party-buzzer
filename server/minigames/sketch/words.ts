import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalize } from './match.ts'

export const SKETCH_WORDS_PATH = fileURLToPath(new URL('../../../packs/sketch-words.txt', import.meta.url))
/** Words offered to the drawer each turn. */
export const CHOICES = 3

/** One word or phrase per line; blank and `#` lines are skipped and repeats dropped. */
export function parseSketchWords(text: string): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim().replace(/\s+/g, ' ')
    const key = normalize(word)
    if (word.startsWith('#') || !key || seen.has(key)) continue
    seen.add(key)
    words.push(word)
  }
  return words
}

export function loadSketchWords(path: string): string[] | null {
  try {
    return parseSketchWords(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
