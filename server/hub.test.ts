import test from 'node:test'
import assert from 'node:assert/strict'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import type { Role, ServerMsg, State } from '../shared/protocol.ts'

function rig() {
  const state = newState()
  const hub = new Hub(state)
  const sent: ServerMsg[][] = []
  const conn = (role: Role, playerId?: string): Conn => {
    const box: ServerMsg[] = []
    sent.push(box)
    const c: Conn = {
      id: Math.random().toString(36).slice(2),
      role,
      playerId,
      send: (m) => box.push(m),
    }
    hub.add(c)
    return c
  }
  const lastState = (c: number): State => (sent[c].at(-1) as { state: State }).state
  return { state, hub, conn, lastState }
}

function joinAs(hub: Hub, conn: Conn, name: string): void {
  hub.handle(conn, { t: 'hello', role: 'player', name })
}

test('host acts append fragments and reveal the answer; player acts of that kind are dropped', () => {
  const { hub, conn, lastState } = rig()
  const host = conn('host')
  const phone = conn('player')
  hub.handle(host, { t: 'act', act: 'fragment', data: 'First fragment.' })
  hub.handle(phone, { t: 'act', act: 'fragment', data: 'forged' })
  hub.handle(host, { t: 'act', act: 'revealAnswer', data: 'The answer' })
  const s = lastState(0)
  assert.deepEqual(s.round.fragments, ['First fragment.'])
  assert.equal(s.round.answer, 'The answer')
})

test('player views strip fragments, answer, and module state', () => {
  const { state, hub, conn } = rig()
  state.game.moduleState = { powerEndsAt: 123 }
  state.round.fragments = ['Secret text']
  state.round.answer = 'Secret answer'
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  const view = hub.viewFor(phone)
  assert.equal(view.round.fragments, undefined)
  assert.equal(view.round.answer, undefined)
  assert.equal(view.game.moduleState, undefined)
  const hostView = hub.viewFor(conn('host'))
  assert.deepEqual(hostView.round.fragments, ['Secret text'])
  assert.deepEqual(hostView.game.moduleState, { powerEndsAt: 123 })
})

test('a frozen player\'s buzz never enters the window', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  const playerId = phone.playerId!
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  state.effects = [{ kind: 'frozen', playerId, roundArmedAt: state.round.armedAt }]
  hub.handle(phone, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'the window never opened')
  assert.equal(state.round.total, 0)
})

test('useItem rides the act channel and broadcast follows', () => {
  const { state, hub, conn } = rig()
  const ada = conn('player')
  const bo = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, bo, 'Bo')
  state.items[ada.playerId!] = ['freeze']
  hub.handle(ada, { t: 'act', act: 'useItem', data: { itemId: 'freeze', targetId: bo.playerId } })
  assert.deepEqual(state.effects, [{ kind: 'frozen', playerId: bo.playerId }])
})

test('unknown acts are dropped and logged once', () => {
  const { hub, conn } = rig()
  const host = conn('host')
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (s: string) => warnings.push(s)
  try {
    hub.handle(host, { t: 'act', act: 'bogus' })
    hub.handle(host, { t: 'act', act: 'bogus' })
  } finally {
    console.warn = orig
  }
  assert.equal(warnings.length, 1)
})
