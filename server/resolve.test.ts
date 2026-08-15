import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBuzzes, type RawBuzz } from './resolve.ts'

const buzz = (playerId: string, at: number, arrivedAt = at + 10): RawBuzz =>
  ({ playerId, at, arrivedAt })

test('orders by corrected stamp, not arrival order', () => {
  // Bea pressed first but her packet landed second.
  const out = resolveBuzzes(
    [buzz('amy', 1050, 1060), buzz('bea', 1020, 1080)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['bea', 'amy'])
})

test('reports deltaMs relative to first place', () => {
  const out = resolveBuzzes([buzz('amy', 1000), buzz('bea', 1038)], 900, [])
  assert.equal(out[0].deltaMs, 0)
  assert.equal(out[1].deltaMs, 38)
})

test('clamps a stamp that predates arming', () => {
  // Cheater claims to have buzzed before the question opened.
  const out = resolveBuzzes(
    [buzz('honest', 1010, 1020), buzz('cheat', -99999, 1015)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['cheat', 'honest'])
  assert.equal(out[0].at, 1000, 'clamped up to armedAt, not left in the past')
  assert.equal(out[1].deltaMs, 10)
})

test('clamps a stamp later than its own arrival', () => {
  const out = resolveBuzzes([buzz('amy', 5000, 1100)], 1000, [])
  assert.equal(out[0].at, 1100)
})

test('an unsynced client falls back to arrival order without breaking', () => {
  // offset never applied, so `at` equals the client's raw epoch: far in the past.
  const out = resolveBuzzes(
    [buzz('synced', 1020, 1030), buzz('unsynced', 0, 1005)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['unsynced', 'synced'])
  assert.equal(out[0].at, 1000)
})

test('breaks exact ties deterministically by arrival then id', () => {
  const a = resolveBuzzes([buzz('zoe', 1000, 1020), buzz('amy', 1000, 1010)], 900, [])
  assert.deepEqual(a.map((b) => b.playerId), ['amy', 'zoe'])

  const b = resolveBuzzes([buzz('zoe', 1000, 1010), buzz('amy', 1000, 1010)], 900, [])
  assert.deepEqual(b.map((b) => b.playerId), ['amy', 'zoe'])
})

test('drops excluded players', () => {
  const out = resolveBuzzes(
    [buzz('locked', 1000), buzz('open', 1050)],
    900,
    ['locked'],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['open'])
  assert.equal(out[0].deltaMs, 0, 'first survivor is the new zero point')
})

test('keeps only the earliest buzz per player', () => {
  const out = resolveBuzzes(
    [buzz('amy', 1080, 1090), buzz('amy', 1010, 1020)],
    900,
    [],
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].at, 1010)
})

test('returns an empty list when everyone is excluded', () => {
  assert.deepEqual(resolveBuzzes([buzz('amy', 1000)], 900, ['amy']), [])
})
