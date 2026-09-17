import test from 'node:test'
import assert from 'node:assert/strict'
import { newState } from '../state.ts'
import { MinigameRuntime } from './runtime.ts'
import { MINIGAMES } from './registry.ts'
import type { MinigameInputAck, HostAction, MinigameFrame } from '../../shared/protocol.ts'
import type { MinigameDefinition } from './definition.ts'

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

type Toy = { tick: number; done: boolean; lobby: unknown }

function withToy(run: (toy: MinigameDefinition<Toy>) => void, refusal: 'ink-cards' | null = null) {
  const toy: MinigameDefinition<Toy> = {
    stepMs: 50,
    untimed: true,
    options: () => ({}),
    prepare: () => refusal,
    startable: (lobby, connected) => connected.every((id) => lobby.teams[id]) ? null : 'unpicked',
    create: (_seed, _participants, _options, lobby) => ({ world: { tick: 0, done: false, lobby } }),
    finished: (world) => world.done,
    classify: (input) => (input as { kind?: string })?.kind === 'finish' ? 'discrete' : null,
    apply: (world) => { world.done = true; return { status: 'accepted' } },
    step: (world) => { world.tick++ },
    tick: (world) => world.tick,
    boardFrame: () => ({}),
    playerFrame: () => ({}),
    results: () => [{ playerId: 'ada', points: 1, shots: 0 }],
    touchAudience: (_world, playerId, target) => ({ players: [playerId], board: target.startsWith('row:') }),
  }
  const registry = MINIGAMES as Record<string, MinigameDefinition<any>>
  registry.toy = toy
  try { run(toy) } finally { delete registry.toy }
}

const prepareToy = (r: ReturnType<typeof rig>) =>
  r.runtime.host({ a: 'prepareMinigame', id: 'toy' as never, options: {} })

test('prepare refuses with the definition reason and creates an empty lobby otherwise', () => {
  withToy(() => {
    const r = rig()
    assert.deepEqual(prepareToy(r), { status: 'refused', reason: 'ink-cards' })
    assert.equal(r.state.minigame, undefined)
  }, 'ink-cards')
  withToy(() => {
    const r = rig()
    assert.deepEqual(prepareToy(r), { status: 'applied' })
    assert.deepEqual(r.state.minigame?.lobby, { teams: {}, volunteers: [] })
  })
})

test('lobby changes apply only while ready and start checks the lobby', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    assert.deepEqual(r.runtime.host({ a: 'startMinigame' }), { status: 'refused', reason: 'unpicked' })
    assert.equal(r.runtime.lobby('ada', { do: 'join', team: 'sun' }), true)
    assert.equal(r.runtime.lobby('bo', { do: 'join', team: 'moon' }), true)
    assert.equal(r.runtime.lobby('nobody', { do: 'join', team: 'moon' }), false)
    assert.deepEqual(r.runtime.host({ a: 'startMinigame' }), { status: 'applied' })
    assert.equal(r.runtime.lobby('ada', { do: 'leave' }), false)
    assert.equal(r.state.minigame?.endsAt, undefined)
  })
})

test('an untimed match runs past any duration and completes when finished', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.setNow(r.state.minigame!.startsAt!)
    r.runtime.pump()
    r.advance(600_000)
    assert.equal(r.completions.length, 0)
    const matchId = r.state.minigame!.matchId
    r.runtime.input('ada', { t: 'minigameInput', matchId, seq: 1, input: { kind: 'finish', at: r.state.minigame!.startsAt! } as never })
    r.advance(60)
    assert.equal(r.completions.length, 1)
  })
})

test('touches reach the audience the definition names, only while playing', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    const touch = (target: string) => ({ t: 'minigameTouch' as const, matchId: r.state.minigame!.matchId, target, x: 0.5, y: 0.5 })
    assert.equal(r.runtime.touch('ada', touch('row:sun:0')), null)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.setNow(r.state.minigame!.startsAt!)
    r.runtime.pump()
    assert.deepEqual(r.runtime.touch('ada', touch('row:sun:0')), { players: ['ada'], board: true })
    assert.equal(r.runtime.touch('ada', { ...touch('card:1'), x: 2 }), null)
    assert.equal(r.runtime.touch('ada', { ...touch('card:1'), matchId: 'old' }), null)
  })
})

test('cancel keeps the lobby and close removes it', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.runtime.host({ a: 'cancelMinigame' })
    assert.deepEqual(r.state.minigame?.lobby?.teams, { ada: 'sun', bo: 'moon' })
    r.runtime.host({ a: 'closeMinigame' })
    assert.equal(r.state.minigame, undefined)
  })
})

// Compile-time exhaustiveness helper: these are the runtime-owned actions.
const _actions: HostAction[] = [
  { a: 'prepareMinigame', id: 'bow', options: {} },
  { a: 'startMinigame' },
  { a: 'cancelMinigame' },
  { a: 'closeMinigame' },
]
void _actions
