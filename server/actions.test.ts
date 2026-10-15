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
    async select() {}, start() {}, carryOn() {}, pause() {}, resume() {}, rewind() {}, closeChoice() {}, announce() {},
    stop() { hub.handle(host, { t: 'act', act: 'reading', data: undefined }) },
  })
  hub.dispatch({ a: 'setValue', value: 400 })
  hub.dispatch({ a: 'undo' })
  assert.deepEqual(values, [400, 100], 'no intermediate pre-restore frame reaches subscribers')
})

test('preparing a minigame stops reader work before the new state is published', () => {
  const { state, hub, host, changes } = rig()
  let stopped = 0
  hub.setReader({ async select() {}, start() {}, carryOn() {}, pause() {}, resume() {}, rewind() {}, closeChoice() {}, announce() {}, stop() { stopped++ } })
  hub.setMinigameRuntime({
    host() {
      state.minigame = { id: 'bow', matchId: 'm', phase: 'ready', options: { durationSec: 40, reloadMs: 700, seed: 1 }, participants: [] }
      return { status: 'applied' }
    },
  } as never)
  host.send = (message) => {
    if (message.t === 'state') assert.equal(stopped, 1, 'reader stops before the minigame state broadcast')
  }

  hub.handle(host, { t: 'host', action: { a: 'prepareMinigame', id: 'bow', options: {} } })

  assert.equal(stopped, 1)
  assert.deepEqual(changes, ['IDLE'])
})

function choiceRoom() {
  const state = newState()
  state.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: true },
    { id: 'cy', name: 'Cy', connected: true },
  ]
  applyHostAction(state, { a: 'arm', kind: 'choice' })
  state.round.value = 300
  state.round.choices = ['Mars', 'Saturn', 'Venus']
  state.round.picks = { ada: 1, bo: 1, cy: 0 }
  return state
}

test('settleChoice pays each right pick the value and costs a wrong pick nothing', () => {
  const state = choiceRoom()
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 1 }), { status: 'applied' })
  assert.equal(state.scores.ada, 300)
  assert.equal(state.scores.bo, 300)
  assert.equal(state.scores.cy ?? 0, 0)
  assert.equal(state.round.correct, 1)
  assert.equal(state.round.phase, 'IDLE')
  assert.equal(state.round.award, undefined, 'no hero, no stamp')
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 1 }), { status: 'refused', reason: 'no-choice' })
})

test('settleChoice pays a team once per right member', () => {
  const state = choiceRoom()
  state.grouping = 'teams'
  state.teams = [{ id: 'red', name: 'Red', color: '#f00' }, { id: 'blue', name: 'Blue', color: '#00f' }]
  state.players[0].teamId = 'red'
  state.players[1].teamId = 'red'
  state.players[2].teamId = 'blue'
  applyHostAction(state, { a: 'settleChoice', correct: 1 })
  assert.equal(state.scores.red, 600)
  assert.equal(state.scores.blue ?? 0, 0)
})

test('settleChoice is refused on a buzz question, before choices, and out of range', () => {
  const state = newState()
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 0 }), { status: 'refused', reason: 'no-choice' })
  applyHostAction(state, { a: 'arm', kind: 'choice' })
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 0 }), { status: 'refused', reason: 'no-choice' })
  state.round.choices = ['a', 'b']
  assert.deepEqual(applyHostAction(state, { a: 'settleChoice', correct: 2 }), { status: 'refused', reason: 'no-choice' })
})

test('arm and next sweep the choice fields', () => {
  const state = choiceRoom()
  state.round.closesAt = 5
  applyHostAction(state, { a: 'settleChoice', correct: 1 })
  applyHostAction(state, { a: 'next' })
  for (const k of ['kind', 'choices', 'picks', 'closesAt', 'correct'] as const) {
    assert.equal(state.round[k], undefined, k)
  }
  applyHostAction(state, { a: 'arm', kind: 'shown' })
  assert.equal(state.round.kind, 'shown')
  applyHostAction(state, { a: 'arm' })
  assert.equal(state.round.kind, undefined)
})

test('undo takes back a settled choice question', () => {
  const { state, hub } = rig()
  Object.assign(state, choiceRoom())
  hub.dispatch({ a: 'settleChoice', correct: 1 })
  assert.equal(state.scores.ada, 300)
  hub.dispatch({ a: 'undo' })
  assert.equal(state.scores.ada ?? 0, 0)
  assert.equal(state.round.correct, undefined)
  assert.deepEqual(state.round.picks, { ada: 1, bo: 1, cy: 0 })
})

function closestRoom() {
  const state = newState()
  state.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: true },
    { id: 'cy', name: 'Cy', connected: true },
  ]
  applyHostAction(state, { a: 'arm', kind: 'closest' })
  state.round.value = 200
  state.round.guessing = { unit: 'steps', closesAt: 1 }
  state.round.guesses = { ada: 1700, bo: 1200, cy: 1500 }
  return state
}

test('settleClosest pays the nearest without a hero, and only once', () => {
  const state = closestRoom()
  assert.deepEqual(applyHostAction(state, { a: 'settleClosest', truth: 1665 }), { status: 'applied' })
  assert.deepEqual(state.scores, { ada: 200 })
  assert.deepEqual(state.round.paid, { ada: 200 })
  assert.equal(state.round.truth, 1665)
  assert.equal(state.round.nearest, 35)
  assert.equal(state.round.phase, 'IDLE')
  assert.equal(state.round.award, undefined)
  assert.deepEqual(applyHostAction(state, { a: 'settleClosest', truth: 1665 }), { status: 'refused', reason: 'no-guessing' })
})

test('settleClosest is refused on a buzz question, before guessing opens, and without a number', () => {
  const state = newState()
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(applyHostAction(state, { a: 'settleClosest', truth: 1 }), { status: 'refused', reason: 'no-guessing' })
  applyHostAction(state, { a: 'arm', kind: 'closest' })
  assert.deepEqual(applyHostAction(state, { a: 'settleClosest', truth: 1 }), { status: 'refused', reason: 'no-guessing' })
  state.round.guessing = { closesAt: 1 }
  assert.deepEqual(applyHostAction(state, { a: 'settleClosest', truth: Number.NaN }), { status: 'refused', reason: 'no-guessing' })
})

test('arm and next sweep the closest fields, and undo takes back a settled one', () => {
  const { state, hub } = rig()
  Object.assign(state, closestRoom())
  hub.dispatch({ a: 'settleClosest', truth: 1665 })
  hub.dispatch({ a: 'undo' })
  assert.equal(state.scores.ada ?? 0, 0)
  assert.equal(state.round.truth, undefined)
  assert.deepEqual(state.round.guesses, { ada: 1700, bo: 1200, cy: 1500 })
  hub.dispatch({ a: 'settleClosest', truth: 1665 })
  hub.dispatch({ a: 'next' })
  for (const k of ['kind', 'guessing', 'guesses', 'truth', 'paid', 'nearest'] as const) {
    assert.equal(state.round[k], undefined, k)
  }
})

test('setChoiceTime clamps to 5..120', () => {
  const state = newState()
  assert.equal(state.choiceSec, 20)
  applyHostAction(state, { a: 'setChoiceTime', sec: 1 })
  assert.equal(state.choiceSec, 5)
  applyHostAction(state, { a: 'setChoiceTime', sec: 500 })
  assert.equal(state.choiceSec, 120)
})

test('setRevealTime clamps to 3..60, and a reveal arm starts its clock from the arm instant', () => {
  const state = newState()
  assert.equal(state.revealSec, 10)
  applyHostAction(state, { a: 'setRevealTime', sec: 1 })
  assert.equal(state.revealSec, 3)
  applyHostAction(state, { a: 'setRevealTime', sec: 500 })
  assert.equal(state.revealSec, 60)
  applyHostAction(state, { a: 'setRevealTime', sec: 10 })
  applyHostAction(state, { a: 'arm', kind: 'reveal' })
  assert.deepEqual(state.round.reveal, { from: state.round.armedAt, until: state.round.armedAt + 10_000 })
  applyHostAction(state, { a: 'next' })
  assert.equal(state.round.reveal, undefined)
  applyHostAction(state, { a: 'arm' })
  assert.equal(state.round.reveal, undefined, 'only a reveal question has one')
})
