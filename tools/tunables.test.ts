import test from 'node:test'
import assert from 'node:assert/strict'
import { setConstant } from './tunables.ts'

const SRC = `export const TOSS = {
  /** Share of a throw's distance covered in the air. */
  airShare: 0.55,
  stepMs: 16,
}

export const REVEAL = {
  beatMs: [150, 300] as const,
  spreadLag: 30,
}

const airShare = 1
`

test('a number in a constant is rewritten in its own line and nowhere else', () => {
  const out = setConstant(SRC, 'TOSS.airShare', '0.6')!
  assert.match(out, /^ {2}airShare: 0\.6,$/m)
  assert.match(out, /^const airShare = 1$/m)
  assert.equal(out.replace('0.6,', '0.55,'), SRC)
})

test('one end of a range is rewritten, the other kept', () => {
  const out = setConstant(SRC, 'REVEAL.beatMs.1', '420')!
  assert.match(out, /^ {2}beatMs: \[150, 420\] as const,$/m)
})

test('a name it cannot find, or a value that is not a plain number, is refused', () => {
  assert.equal(setConstant(SRC, 'TOSS.nope', '1'), null)
  assert.equal(setConstant(SRC, 'NOPE.airShare', '1'), null)
  assert.equal(setConstant(SRC, 'REVEAL.spreadLag', '1; process.exit()'), null)
  assert.equal(setConstant(SRC, 'REVEAL.beatMs.2', '1'), null)
  assert.equal(setConstant(SRC, 'TOSS.airShare.0', '1'), null)
  assert.equal(setConstant(SRC, 'REVEAL.airShare', '1'), null)
  assert.equal(setConstant(SRC, 'TOSS.\\w+', '1'), null)
})
