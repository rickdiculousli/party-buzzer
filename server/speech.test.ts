import test from 'node:test'
import assert from 'node:assert/strict'
import { clipPath, parseDuration } from './speech.ts'

test('the cache key follows the text and the voice', () => {
  const a = clipPath('/tmp/c', 'Which element has atomic number 79?')
  const b = clipPath('/tmp/c', 'Which element has atomic number 79?')
  const c = clipPath('/tmp/c', 'A different sentence entirely.')
  const d = clipPath('/tmp/c', 'Which element has atomic number 79?', 'Fred')
  assert.equal(a, b, 'same text and voice must hit the same clip')
  assert.notEqual(a, c, 'different text must miss')
  assert.notEqual(a, d, 'different voice must miss')
  assert.match(a, /\.aiff$/)
})

test('parseDuration reads afinfo, and survives output without one', () => {
  const out = [
    'File:           frag.aiff',
    'File type ID:   AIFC',
    'estimated duration: 4.847982 sec',
    'audio bytes: 213796',
  ].join('\n')
  assert.equal(parseDuration(out), 4848)
  assert.equal(parseDuration('no duration here'), 0)
})
