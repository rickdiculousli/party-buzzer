import test from 'node:test'
import assert from 'node:assert/strict'
import { loadInkCards, parseInkCards } from './cards.ts'

const prompts = (n: number) => Array.from({ length: n }, (_, i) => `P: Prompt ${i}?`).join('\n')

test('parses prompts and six-word cards, skipping blanks and comments', () => {
  const cards = parseInkCards(`# mine\n${prompts(16)}\n\nW: Apple | Calendar | Snowman | Chili | Fox | Table\n`)
  assert.equal(typeof cards, 'object')
  if (typeof cards === 'string') return
  assert.equal(cards.prompts.length, 16)
  assert.equal(cards.prompts[0], 'Prompt 0?')
  assert.deepEqual(cards.words, [['Apple', 'Calendar', 'Snowman', 'Chili', 'Fox', 'Table']])
})

test('reports the line of a malformed entry', () => {
  assert.equal(parseInkCards(`${prompts(16)}\nW: One | Two`), 'Line 17: a word card needs 6 words')
  assert.equal(parseInkCards(`${prompts(16)}\nhello`), 'Line 17: start the line with P: or W:')
})

test('needs 16 prompts and a word card', () => {
  assert.equal(parseInkCards(`${prompts(15)}\nW: a|b|c|d|e|f`), 'At least 16 prompts are needed')
  assert.equal(parseInkCards(prompts(16)), 'At least one word card is needed')
})

test('a missing file is an error message', () => {
  assert.equal(loadInkCards('/nonexistent/phantom-ink.txt'), 'packs/phantom-ink.txt is missing')
})
