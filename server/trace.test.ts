import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { makeTracer } from './trace.ts'

const TMP = 'server/.trace-test.jsonl'

test('makeTracer truncates at creation, then appends one frame per call', (t) => {
  t.after(() => rmSync(TMP, { force: true }))
  const trace = makeTracer(TMP)
  trace('join', { players: [{ id: 'a' }] } as never)
  trace('buzz', { players: [{ id: 'a' }], round: { phase: 'COLLECTING' } } as never)
  const frames = readFileSync(TMP, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].seq, 0)
  assert.equal(frames[1].seq, 1)
  assert.equal(frames[1].cause, 'buzz')
  assert.equal(frames[1].state.round.phase, 'COLLECTING')
  assert.equal(typeof frames[0].t, 'number')
})

test('a second makeTracer on the same path starts the file over', (t) => {
  t.after(() => rmSync(TMP, { force: true }))
  makeTracer(TMP)('a', {} as never)
  makeTracer(TMP)('b', {} as never)
  const lines = readFileSync(TMP, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).cause, 'b')
})

test('frames are immune to later mutation of the state object', (t) => {
  t.after(() => rmSync(TMP, { force: true }))
  const trace = makeTracer(TMP)
  const state = { round: { phase: 'IDLE' } }
  trace('arm', state as never)
  state.round.phase = 'ARMED'
  const frame = JSON.parse(readFileSync(TMP, 'utf8').trim())
  assert.equal(frame.state.round.phase, 'IDLE')
})

import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'

const conn = (role: 'host' | 'player', playerId?: string): Conn & { sent: unknown[] } => ({
  id: Math.random().toString(36).slice(2),
  role,
  playerId,
  sent: [],
  send(msg) { this.sent.push(msg) },
})

test('hub writes one frame per transition, cause-labelled, when tracePath is set', (t) => {
  t.after(() => rmSync(TMP, { force: true }))
  const hub = new Hub(newState(), { tracePath: TMP })
  const host = conn('host')
  hub.add(host)
  const ada = conn('player')
  hub.add(ada)
  hub.send(ada, { t: 'hello', role: 'player', playerId: 'ada', name: 'Ada' })
  hub.send(host, { t: 'host', action: { a: 'setValue', value: 200 } })
  hub.send(host, { t: 'host', action: { a: 'arm' } })
  const frames = readFileSync(TMP, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(frames.map((f) => f.cause), ['join', 'host:setValue', 'host:arm'])
  assert.deepEqual(frames.map((f) => f.seq), [0, 1, 2])
  assert.equal(frames[2].state.round.phase, 'ARMED')
})

test('hub writes nothing and builds no tracer without tracePath', () => {
  const hub = new Hub(newState())
  assert.equal(existsSync(TMP), false)
  const host = conn('host')
  hub.add(host)
  hub.send(host, { t: 'host', action: { a: 'arm' } })
  assert.equal(existsSync(TMP), false)
})
