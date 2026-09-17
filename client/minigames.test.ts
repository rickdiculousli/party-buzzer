import test from 'node:test'
import assert from 'node:assert/strict'
import { MINIGAME_TIMED } from './minigame-info.ts'

test('only ink runs without a clock', () => {
  assert.deepEqual(MINIGAME_TIMED, { bow: true, tank: true, ink: false })
})
