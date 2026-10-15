import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushNights, nightDate, saveNight } from './nights.ts'
import { newState } from './state.ts'

test('the keepsake files under the evening the night began and is never blanked by a cleared ledger', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-nights-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }]
  state.scores = { a: 100 }
  const began = new Date(2026, 9, 14, 23, 50).getTime()
  state.night = { facts: [
    { kind: 'verdict', at: began, questionId: 'q1', playerId: 'a', key: 'a', name: 'Ada', points: 100, hit: true, source: 'buzz', reactionMs: 200 },
  ] }
  const pastMidnight = new Date(2026, 9, 15, 0, 20)
  assert.equal(nightDate(state, pastMidnight), '2026-10-14')
  saveNight(dir, state, pastMidnight)
  flushNights()
  assert.deepEqual(readdirSync(dir), ['2026-10-14.json'])
  const written = JSON.parse(readFileSync(join(dir, '2026-10-14.json'), 'utf8'))
  assert.equal(written.date, '2026-10-14')
  assert.equal(written.cards[0].name, 'Ada')
  state.night = { facts: [] }
  saveNight(dir, state, pastMidnight)
  flushNights()
  assert.equal(JSON.parse(readFileSync(join(dir, '2026-10-14.json'), 'utf8')).cards[0].name, 'Ada', 'a cleared night writes nothing')
  assert.equal(nightDate(newState(), pastMidnight), '2026-10-15', 'an empty night is dated now')
  assert.equal(existsSync(join(dir, '2026-10-15.json')), false)
})
