import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub, type Conn } from './hub.ts'
import { newState, saveState, flushSave, loadState } from './state.ts'

const host: Conn = { id: 'host', role: 'host', send() {} }

test('undo removes newly introduced optional game data', () => {
  const state = newState()
  const hub = new Hub(state)
  hub.handle(host, { t: 'host', action: { a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }] } })
  assert.ok(state.setlist)
  hub.handle(host, { t: 'host', action: { a: 'undo' } })
  assert.equal(state.setlist, undefined)
  hub.handle(host, { t: 'host', action: { a: 'openDuel', rule: 'vote' } })
  assert.ok(state.duel)
  hub.handle(host, { t: 'host', action: { a: 'undo' } })
  assert.equal(state.duel, undefined)
})

test('undo preserves current connections, new arrivals and refreshed catalogs', () => {
  const state = newState()
  const hub = new Hub(state)
  const ada: Conn = { id: 'ada', role: 'player', send() {} }
  const bo: Conn = { id: 'bo', role: 'player', send() {} }
  hub.add(ada)
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada' })
  hub.handle(host, { t: 'host', action: { a: 'setValue', value: 400 } })
  hub.remove(ada)
  hub.add(bo)
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  state.packs = ['new.txt']
  hub.handle(host, { t: 'host', action: { a: 'undo' } })
  assert.equal(state.round.value, 100)
  assert.equal(state.players.find((p) => p.id === ada.playerId)?.connected, false)
  assert.equal(state.players.find((p) => p.id === bo.playerId)?.connected, true)
  assert.equal(state.scores[bo.playerId!], 0)
  assert.deepEqual(state.packs, ['new.txt'])
})

test('undo stops playback and reopens collection instead of restoring a missing timer', () => {
  const state = newState()
  let stopped = 0
  const hub = new Hub(state, { reader: {
    async select() {}, start() {}, pause() {}, resume() {}, rewind() {}, closeChoice() {}, stop() { stopped++ },
  } })
  state.round.phase = 'COLLECTING'
  state.round.order = [{ playerId: 'a', name: 'Ada', at: 1, deltaMs: 0 }]
  state.round.total = 1
  hub.handle(host, { t: 'host', action: { a: 'setValue', value: 400 } })
  hub.handle(host, { t: 'host', action: { a: 'undo' } })
  assert.equal(stopped, 1)
  assert.equal(state.round.phase, 'ARMED')
  assert.deepEqual(state.round.order, [])
  assert.equal(state.round.total, 0)
  assert.equal(state.reading, undefined)
})

test('versioned saves retain durable data and independently flush multiple files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-snapshot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }]
  state.scores.a = 700
  state.round = { ...state.round, phase: 'LOCKED', armedAt: 123, judge: {}, spoken: { name: 'Ada', transcript: 'old', hit: true }, whole: 'secret', lockedOut: ['a'] }
  state.packs = ['old.txt']
  const first = join(dir, 'one.json')
  const second = join(dir, 'two.json')
  saveState(first, state)
  state.scores.a = 900
  saveState(second, state)
  flushSave()
  const disk = JSON.parse(readFileSync(first, 'utf8'))
  assert.equal(disk.version, 1)
  assert.equal(disk.state.players[0].connected, undefined)
  assert.equal(disk.state.packs, undefined)
  assert.deepEqual(disk.state.round, { value: 100 })
  const loaded = loadState(first)
  assert.equal(loaded.scores.a, 700)
  assert.equal(loadState(second).scores.a, 900)
  assert.deepEqual(loaded.round, newState().round)
  assert.equal(loaded.players[0].connected, false)
  assert.deepEqual(loaded.packs, [])
  // Original unversioned snapshots follow the same restart policy.
  writeFileSync(first, JSON.stringify(state))
  assert.deepEqual(loadState(first).round, newState().round)
})

test('a playing minigame saves as ready but keeps its checkpoint', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-snapshot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const state = newState()
  const checkpoint = { version: 12, label: 'hand 12', data: { seed: 1 } }
  state.minigame = {
    id: 'bow', matchId: 'm', phase: 'playing', options: { durationSec: 40, seed: 1 }, participants: ['a'],
    startsAt: 1, checkpoint,
  }
  const file = join(dir, 'state.json')
  saveState(file, state)
  flushSave()
  const loaded = loadState(file)
  assert.equal(loaded.minigame?.phase, 'ready')
  assert.deepEqual(loaded.minigame?.checkpoint, checkpoint)
})

test('a restart drops a playing minigame\'s host lines', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-snapshot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const state = newState()
  state.minigame = {
    id: 'poker', matchId: 'm', phase: 'playing', options: { durationSec: 40, seed: 1 }, participants: ['a'],
    startsAt: 1, status: [{ text: 'Hand 4' }],
  }
  const file = join(dir, 'state.json')
  saveState(file, state)
  flushSave()
  assert.equal(loadState(file).minigame?.status, undefined)
})
