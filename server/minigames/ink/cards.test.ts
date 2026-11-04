import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INK_SAMPLE_PATH, loadInkCards, loadInkDeck, parseInkCards } from './cards.ts'

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

test('the shipped sample deck parses', () => {
  assert.equal(typeof loadInkCards(INK_SAMPLE_PATH), 'object')
})

test('the sample deck loads only with INK_SAMPLE=1 and no real deck; the real deck wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ink-'))
  try {
    const real = join(dir, 'real.txt')
    const sample = INK_SAMPLE_PATH
    const on = { INK_SAMPLE: '1' }
    assert.equal(loadInkDeck(real, sample, {}), 'packs/phantom-ink.txt is missing')
    assert.equal(loadInkDeck(real, sample, { INK_SAMPLE: '0' }), 'packs/phantom-ink.txt is missing')
    assert.deepEqual(loadInkDeck(real, sample, on), loadInkCards(sample))
    writeFileSync(real, `${prompts(16)}\nW: a|b|c|d|e|f`)
    assert.deepEqual((loadInkDeck(real, sample, on) as { words: string[][] }).words, [['a', 'b', 'c', 'd', 'e', 'f']])
    writeFileSync(real, 'P: broken')
    assert.equal(loadInkDeck(real, sample, on), 'At least 16 prompts are needed') // a broken real deck is not papered over
  } finally {
    rmSync(dir, { recursive: true })
  }
})
