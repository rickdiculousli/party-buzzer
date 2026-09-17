import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type InkCards = { prompts: string[]; words: string[][] }

/** Transcribed from the owner's cards; gitignored. */
export const INK_CARDS_PATH = fileURLToPath(new URL('../../../packs/phantom-ink.txt', import.meta.url))

export function parseInkCards(text: string): InkCards | string {
  const cards: InkCards = { prompts: [], words: [] }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('P:')) cards.prompts.push(line.slice(2).trim())
    else if (line.startsWith('W:')) {
      const words = line.slice(2).split('|').map((word) => word.trim()).filter(Boolean)
      if (words.length !== 6) return `Line ${i + 1}: a word card needs 6 words`
      cards.words.push(words)
    } else return `Line ${i + 1}: start the line with P: or W:`
  }
  if (cards.prompts.length < 16) return 'At least 16 prompts are needed'
  if (cards.words.length === 0) return 'At least one word card is needed'
  return cards
}

export function loadInkCards(path: string): InkCards | string {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return 'packs/phantom-ink.txt is missing'
  }
  return parseInkCards(text)
}
