import test from 'node:test'
import assert from 'node:assert/strict'
import { safeRaw } from './sndlib.ts'

const ROOT = '/repo/sounds/raw'

test('a plain name resolves inside the holding ground', () => {
  assert.equal(safeRaw(ROOT, 'buzzer.wav'), '/repo/sounds/raw/buzzer.wav')
})

// Dev-only is not a reason to skip this. The moment a name crosses an HTTP
// boundary it is untrusted, and a traversal here reads any file on the machine.
test('a name escaping the holding ground is refused', () => {
  assert.equal(safeRaw(ROOT, '../../etc/passwd'), null)
  assert.equal(safeRaw(ROOT, '/etc/passwd'), null)
  assert.equal(safeRaw(ROOT, 'nested/../../out.wav'), null)
})

test('a name that is not audio is refused', () => {
  assert.equal(safeRaw(ROOT, 'notes.txt'), null)
  assert.equal(safeRaw(ROOT, ''), null)
})
