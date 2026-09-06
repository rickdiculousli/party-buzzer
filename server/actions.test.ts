import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub, type Conn } from './hub.ts'
import { applyHostAction, newState } from './state.ts'
import type { ServerMsg } from '../shared/protocol.ts'

function rig() {
  const messages: ServerMsg[] = []
  const state = newState()
  const changes: string[] = []
  const hub = new Hub(state, { collectMs: 30, revealMs: 10, onChange: (s) => changes.push(s.round.phase) })
  const host: Conn = { id: 'host', role: 'host', send: (m) => messages.push(m) }
  hub.add(host)
  return { state, hub, host, messages, changes }
}

test('host actions report applied, unchanged and refused without mutating on refusal', () => {
  const state = newState()
  assert.deepEqual(applyHostAction(state, { a: 'setValue', value: 400 }), { status: 'applied' })
  assert.deepEqual(applyHostAction(state, { a: 'setValue', value: 400 }), { status: 'unchanged' })
  state.duel = { rule: 'vote', pool: [], missed: [] }
  const before = structuredClone(state)
  assert.deepEqual(applyHostAction(state, { a: 'setMode', id: 'missing', options: {} }), {
    status: 'refused', reason: 'unknown-mode',
  })
  assert.deepEqual(state, before, 'refusal does not clear a pending duel')
})

test('refused and unchanged commands consume no history and publish no game changes', () => {
  const { state, hub, host, messages, changes } = rig()
  hub.handle(host, { t: 'host', action: { a: 'setValue', value: 400 } })
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'setValue', result: { status: 'applied' } })
  hub.handle(host, { t: 'host', action: { a: 'setValue', value: 400 } })
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'setValue', result: { status: 'unchanged' } })
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'correct', result: { status: 'refused', reason: 'no-leader' } })
  assert.equal(changes.length, 1)
  assert.deepEqual(hub.dispatch({ a: 'undo' }), { status: 'applied' })
  assert.equal(state.round.value, 100, 'one undo takes back the actual edit')
  assert.deepEqual(hub.dispatch({ a: 'undo' }), { status: 'unchanged' })
  assert.equal(changes.length, 2)
})

test('an empty undo and a premature verdict leave collection timers running', async () => {
  const { state, hub } = rig()
  const phone: Conn = { id: 'ada', playerId: 'ada', role: 'player', send() {} }
  hub.handle(phone, { t: 'hello', role: 'player', name: 'Ada', playerId: 'ada' })
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  hub.handle(phone, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'COLLECTING')
  assert.deepEqual(hub.dispatch({ a: 'undo' }), { status: 'unchanged' })
  assert.deepEqual(hub.dispatch({ a: 'correct' }), { status: 'refused', reason: 'no-leader' })
  await sleep(65)
  assert.equal(state.round.phase, 'LOCKED')
  assert.equal(state.round.order[0]?.playerId, 'ada')
})

test('direct automation and socket host commands share history and verdict outcomes', () => {
  const { state, hub, host, messages } = rig()
  state.players = [{ id: 'ada', name: 'Ada', connected: true }]
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'ada', name: 'Ada', at: 1, deltaMs: 0 }]
  assert.deepEqual(hub.dispatch({ a: 'correct' }), { status: 'applied' })
  assert.equal(state.scores.ada, 100)
  hub.handle(host, { t: 'host', action: { a: 'undo' } })
  assert.equal(state.scores.ada, undefined)
  assert.equal(state.round.phase, 'LOCKED')
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  assert.equal(state.scores.ada, 100)
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'correct', result: { status: 'applied' } })
})

test('loading a setlist is one command with the same undo and refusal semantics', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-actions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'night.json'), JSON.stringify([{ game: 'trivia', options: {}, count: 2, value: 400 }]))
  const state = newState()
  const hub = new Hub(state, { setlistDir: dir })
  const messages: ServerMsg[] = []
  const host: Conn = { id: 'host', role: 'host', send: (m) => messages.push(m) }
  hub.handle(host, { t: 'act', act: 'loadSetlist', data: 'night.json' })
  assert.equal(state.round.value, 400)
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'loadSetlist', result: { status: 'applied' } })
  hub.dispatch({ a: 'undo' })
  assert.equal(state.setlist, undefined)
  assert.equal(state.round.value, 100)
  hub.dispatch({ a: 'arm' })
  hub.handle(host, { t: 'act', act: 'loadSetlist', data: 'night.json' })
  assert.deepEqual(messages.at(-1), { t: 'actionResult', action: 'loadSetlist', result: { status: 'refused', reason: 'not-idle' } })
  hub.dispatch({ a: 'undo' })
  assert.equal(state.round.phase, 'IDLE', 'the refused load did not add a history step')
})

test('undo publishes a complete restoration after stopping reader runtime', () => {
  const state = newState()
  const values: number[] = []
  const hub = new Hub(state, { onChange: (s) => values.push(s.round.value) })
  const host: Conn = { id: 'reader', role: 'host', send() {} }
  hub.setReader({
    async select() {}, start() {}, pause() {}, resume() {}, rewind() {},
    stop() { hub.handle(host, { t: 'act', act: 'reading', data: undefined }) },
  })
  hub.dispatch({ a: 'setValue', value: 400 })
  hub.dispatch({ a: 'undo' })
  assert.deepEqual(values, [400, 100], 'no intermediate pre-restore frame reaches subscribers')
})
