import test from 'node:test'
import assert from 'node:assert/strict'
import { newState } from '../state.ts'
import { MinigameRuntime } from './runtime.ts'
import type { MinigameInputAck, HostAction, MinigameFrame } from '../../shared/protocol.ts'

function rig() {
  let now = 1_000
  const state = newState()
  state.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: true },
  ]
  const changes: string[] = []
  const frames: MinigameFrame[] = []
  const acks: MinigameInputAck[] = []
  const completions: unknown[] = []
  const runtime = new MinigameRuntime(state, {
    now: () => now,
    onState: (cause) => changes.push(cause),
    onFrame: () => {
      const frame = runtime.frameFor('board')
      if (frame) frames.push(frame)
    },
    onAck: (_playerId, ack) => acks.push(ack),
    onComplete: (matchId, results) => completions.push({ matchId, results }),
  })
  return {
    state, runtime, changes, frames, acks, completions,
    setNow(value: number) { now = value },
    advance(ms: number) { now += ms; runtime.pump() },
  }
}

test('prepare and start create one synchronized bow match for connected players', () => {
  const r = rig()
  assert.deepEqual(r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: { durationSec: 10, seed: 7 } }), { status: 'applied' })
  assert.equal(r.state.minigame?.phase, 'ready')
  assert.deepEqual(r.runtime.host({ a: 'startMinigame' }), { status: 'applied' })
  assert.equal(r.state.minigame?.phase, 'countdown')
  assert.deepEqual(r.state.minigame?.participants, ['ada', 'bo'])
  assert.equal(r.state.minigame?.startsAt, 4_000)
  assert.equal(r.state.minigame?.endsAt, 14_000)
})

test('countdown publishes frames so every surface can advance its clock', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: {} })
  r.runtime.host({ a: 'startMinigame' })
  r.advance(60)
  assert.equal(r.frames.length, 1)
  assert.equal(r.state.minigame?.phase, 'countdown')
})

test('playing publishes a fresh frame on every 16ms runtime pump', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: {} })
  r.runtime.host({ a: 'startMinigame' })
  r.setNow(r.state.minigame!.startsAt!)
  r.runtime.pump()
  const before = r.frames.length
  r.advance(16)
  r.advance(16)
  assert.equal(r.frames.length, before + 2)
})

test('an accepted release fires once on the next legal fixed step', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: { durationSec: 10, seed: 7 } })
  r.runtime.host({ a: 'startMinigame' })
  r.setNow(r.state.minigame!.startsAt!)
  r.runtime.pump()
  assert.equal(r.state.minigame?.phase, 'playing')

  r.runtime.input('ada', { t: 'minigameInput', matchId: r.state.minigame!.matchId, seq: 1, input: { kind: 'aim', angle: 0, tension: 1 } })
  r.runtime.input('ada', { t: 'minigameInput', matchId: r.state.minigame!.matchId, seq: 2, input: { kind: 'release', at: r.state.minigame!.startsAt! } })
  assert.equal(r.acks.length, 0)
  r.advance(17)
  assert.deepEqual(r.acks, [{ matchId: r.state.minigame!.matchId, seq: 2, status: 'accepted' }])
  const board = r.runtime.frameFor('board')
  assert.equal(board?.role, 'board')
  if (board?.role === 'board' && board.id === 'bow') assert.equal(board.arrows.length, 1)

  r.runtime.input('ada', { t: 'minigameInput', matchId: r.state.minigame!.matchId, seq: 2, input: { kind: 'release', at: r.state.minigame!.startsAt! } })
  r.advance(17)
  const again = r.runtime.frameFor('board')
  if (again?.role === 'board' && again.id === 'bow') assert.equal(again.arrows.length, 1)
  assert.equal(r.acks.length, 2, 'a retry receives the remembered disposition')
})

test('dropped catch-up time keeps projected reload aligned with server acceptance', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: { reloadMs: 700 } })
  r.runtime.host({ a: 'startMinigame' })
  r.setNow(r.state.minigame!.startsAt!)
  r.runtime.pump()
  const matchId = r.state.minigame!.matchId
  r.runtime.input('ada', { t: 'minigameInput', matchId, seq: 1, input: { kind: 'release', at: r.state.minigame!.startsAt! } })
  r.advance(17)
  r.advance(1_000)
  const player = r.runtime.frameFor('player', 'ada')
  assert.equal(player?.role, 'player')
  if (player?.role === 'player' && player.id === 'bow') assert.ok(player.player.reloadUntilMs > player.serverTime)
})

test('frames are role-specific and a late joiner spectates', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: {} })
  r.runtime.host({ a: 'startMinigame' })
  r.state.players.push({ id: 'cy', name: 'Cy', connected: true })
  const board = r.runtime.frameFor('board')
  const ada = r.runtime.frameFor('player', 'ada')
  const cy = r.runtime.frameFor('player', 'cy')
  assert.equal(board?.role, 'board')
  assert.equal(ada?.role, 'player')
  assert.equal(cy?.role, 'spectator')
  if (ada?.role === 'player' && ada.id === 'bow') assert.equal('arrows' in ada, false)
})

test('deadline completes once after landing grace', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: { durationSec: 5 } })
  r.runtime.host({ a: 'startMinigame' })
  r.setNow(r.state.minigame!.endsAt! + 2_999)
  r.runtime.pump()
  assert.equal(r.completions.length, 0)
  r.advance(1)
  assert.equal(r.completions.length, 1)
  r.advance(1_000)
  assert.equal(r.completions.length, 1)
})

test('cancel clears transient play without awarding', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'bow', options: {} })
  r.runtime.host({ a: 'startMinigame' })
  const first = r.state.minigame!.matchId
  assert.deepEqual(r.runtime.host({ a: 'cancelMinigame' }), { status: 'applied' })
  assert.equal(r.state.minigame?.phase, 'ready')
  assert.notEqual(r.state.minigame?.matchId, first)
  assert.equal(r.completions.length, 0)
})

test('prepare refuses a minigame the registry does not know', () => {
  const r = rig()
  assert.deepEqual(
    r.runtime.host({ a: 'prepareMinigame', id: 'nope' as 'bow', options: {} }),
    { status: 'refused', reason: 'unknown-mode' },
  )
  assert.equal(r.state.minigame, undefined)
})

test('a tank match forms crews, runs inputs, sends cover once, and credits both crew members', () => {
  const r = rig()
  r.runtime.host({ a: 'prepareMinigame', id: 'tank', options: { durationSec: 5, seed: 3 } })
  r.runtime.host({ a: 'startMinigame' })
  const session = r.state.minigame!
  assert.equal(session.crews?.length, 1)
  const { driver, gunner } = session.crews![0]
  assert.deepEqual([driver, gunner].sort(), ['ada', 'bo'])

  r.advance(60)
  r.advance(60)
  const [first, second] = r.frames
  assert.ok(first.role === 'board' && first.id === 'tank' && first.cover?.length === 160 * 90)
  assert.ok(second.role === 'board' && second.id === 'tank' && second.cover === undefined)

  r.setNow(session.startsAt!)
  r.runtime.pump()
  const turn = { kind: 'turn', rate: 1 } as const
  r.runtime.input(gunner, { t: 'minigameInput', matchId: session.matchId, seq: 1, input: turn })
  r.runtime.input(gunner, { t: 'minigameInput', matchId: session.matchId, seq: 2, input: { kind: 'trigger', weapon: 'cannon', down: true, at: session.startsAt! } })
  r.advance(17)
  assert.deepEqual(r.acks.at(-1), { matchId: session.matchId, seq: 2, status: 'accepted' })
  const mine = r.runtime.frameFor('player', gunner)
  assert.ok(mine?.role === 'player' && mine.id === 'tank')
  if (mine?.role === 'player' && mine.id === 'tank') {
    assert.ok(mine.tank.turret > 0)
    assert.equal(mine.tank.cannon.clip, 0)
    assert.ok(mine.tank.cannon.reloadUntil > mine.serverTime)
  }

  r.setNow(session.endsAt! + 3_000)
  r.runtime.pump()
  const { results } = r.completions[0] as { results: { playerId: string }[] }
  assert.deepEqual(results.map((result) => result.playerId).sort(), ['ada', 'bo'])
})

// Compile-time exhaustiveness helper: these are the runtime-owned actions.
const _actions: HostAction[] = [
  { a: 'prepareMinigame', id: 'bow', options: {} },
  { a: 'startMinigame' },
  { a: 'cancelMinigame' },
  { a: 'closeMinigame' },
]
void _actions
