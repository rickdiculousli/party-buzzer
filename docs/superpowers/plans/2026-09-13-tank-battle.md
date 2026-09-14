# Tank Battle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-person-crew tank battle minigame beside bow, behind a minigame registry.

**Architecture:** `MinigameRuntime` keeps lifecycle, clocks, input queueing and acks, and calls a `MinigameDefinition` from a static registry for world creation, input, stepping, frames and results. Bow moves behind that interface unchanged. Tank is a second definition with a cell-grid cover map, crews, and wheel/button phone controls.

**Tech Stack:** Node native TypeScript server, Preact client, SVG rendering, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-13-tank-battle-design.md`

## Global Constraints

- Relative imports use `.ts` / `.tsx` extensions.
- Tests run with `node --test`; typecheck with `npm run typecheck`. One known pre-existing failure on main: "a held-open clip answers one request before being asked the next".
- Fixed step 1000/60 ms; field 1600×900; cover grid 160×90 cells of 10 px.
- Tank: 100 HP, forward 160 px/s, backward 100 px/s, one wheel turn = 90°, no rotation rate cap, turret angle relative to hull.
- Gun: 5 damage, clip 20, 10 rounds/s held, 2 s reload once empty, 8 px blast carves cover only.
- Cannon: 30 damage, clip 1, 3 s reload after each shot, 40 px blast carves cover and splashes 20→0 linearly, including the firing tank; a direct-hit tank takes no splash.
- Respawn after 3 s at the spawn farthest from living enemies, 2 s invulnerable.
- Scoring: 1 point per damage dealt to other tanks, 50 per kill, both crew members get the crew total.
- Comments describe the code as it is now, never its history.
- Placeholder geometric visuals only.

## Deliberate deviations from the spec

Recorded here and applied to the spec in Task 1:

- Crews are formed at **Start**, not Prepare: participants are only fixed at Start. Replay (Cancel → Start) still reshuffles.
- Board cover is an SVG `<path>` rebuilt when cover changes, not a `<canvas>`. It scales with the same viewBox and needs no alignment code.
- The full cover grid is sent on the first frame and then once per second, not per connecting board. The runtime keeps no per-connection state; a board joining mid-match sees cover within a second.
- Tanks collide and are hit as 22 px circles, not 50×34 rectangles (drawn as rectangles).

## File map

| File | Responsibility |
|---|---|
| `shared/protocol.ts` | `MinigameId`, generic input/ack/frame types, `TankCrew`, tank frames |
| `server/minigames/definition.ts` | `MinigameDefinition` type, `numberOption` |
| `server/minigames/registry.ts` | `MINIGAMES` map |
| `server/minigames/bow/definition.ts` | Bow adapter over existing `bow/world.ts` |
| `server/minigames/runtime.ts` | Generic lifecycle, queue, acks, clock |
| `server/minigames/tank/types.ts` | Tank world types and constants |
| `server/minigames/tank/cover.ts` | Cover grid generation, lookup, carving, encoding |
| `server/minigames/tank/world.ts` | Crews, input, step, damage, respawn, results |
| `server/minigames/tank/definition.ts` | Tank adapter and frames |
| `client/minigames.tsx` | Static player/board surface maps |
| `client/tank-control.ts` | Wheel angle unwrapping, ammo helpers |
| `client/TankPlayer.tsx` | Wheel, drive and weapon buttons |
| `client/TankBoard.tsx` | Field, cover path, tanks, aim lines, projectiles, blasts |
| `tools/sim-tank.ts` | Bot crews in the live room |

---

### Task 1: Minigame registry with bow behind it

Bow behavior does not change. The existing runtime, world and integration tests are the check.

**Files:**
- Modify: `shared/protocol.ts` (minigame types near line 237, `HostAction` near 378)
- Create: `server/minigames/definition.ts`, `server/minigames/registry.ts`, `server/minigames/bow/definition.ts`
- Modify: `server/minigames/runtime.ts` (rewrite), `server/hub.ts:542`, `client/useSocket.ts:3,76`, `client/BowPlayer.tsx:2`
- Modify: `docs/superpowers/specs/2026-09-13-tank-battle-design.md` (deviations)
- Test: `server/minigames/runtime.test.ts`

**Interfaces:**
- Produces: `MinigameId`, `MinigameInputMsg`, `MinigameInputAck` in `shared/protocol.ts`; `MinigameDefinition<W>`, `InputOutcome`, `Clock`, `numberOption` in `server/minigames/definition.ts`; `MINIGAMES` in `server/minigames/registry.ts`.

- [ ] **Step 1: Write the failing test**

Append to `server/minigames/runtime.test.ts`:

```ts
test('prepare refuses a minigame the registry does not know', () => {
  const r = rig()
  assert.deepEqual(
    r.runtime.host({ a: 'prepareMinigame', id: 'nope' as 'bow', options: {} }),
    { status: 'refused', reason: 'unknown-mode' },
  )
  assert.equal(r.state.minigame, undefined)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/minigames/runtime.test.ts`
Expected: the new test FAILS (status `applied`); the others pass.

- [ ] **Step 3: Rename the bow-specific wire types**

```bash
grep -rl 'BowInputAck\|BowInputMsg' server client shared tools | xargs sed -i '' -e 's/BowInputAck/MinigameInputAck/g' -e 's/BowInputMsg/MinigameInputMsg/g'
```

Then in `shared/protocol.ts`:

```ts
export type MinigameId = 'bow'
export type MinigamePhase = 'ready' | 'countdown' | 'playing' | 'results'
export type MinigameResult = { playerId: PlayerId; points: number; shots: number }
export type MinigameState = {
  id: MinigameId
  matchId: string
  phase: MinigamePhase
  /** The runtime owns duration and seed; each minigame adds its own numeric options. */
  options: { durationSec: number; seed: number } & Record<string, number>
  participants: PlayerId[]
  startsAt?: number
  endsAt?: number
  results?: MinigameResult[]
}
```

Change `BowFrameBase` to `{ id: MinigameId; matchId: string; tick: number; serverTime: number }` and the host action to `{ a: 'prepareMinigame'; id: MinigameId; options: Record<string, unknown> }`.

`MinigameInputMsg.input` stays `BowInput` for now; Task 4 widens it.

- [ ] **Step 4: Create `server/minigames/definition.ts`**

```ts
import type { MinigameInputAck, MinigameResult } from '../../shared/protocol.ts'

export type InputOutcome =
  | { status: 'accepted' }
  | { status: 'refused'; reason: NonNullable<MinigameInputAck['reason']> }

/** Maps a world time in ms to server time. */
export type Clock = (worldMs: number) => number

/**
 * Everything the runtime needs from one minigame. The runtime owns lifecycle,
 * clocks, input queueing, dispositions and acks.
 */
export type MinigameDefinition<W> = {
  stepMs: number
  /** Game-specific numeric options; the runtime sanitizes durationSec and seed. */
  options(raw: Record<string, unknown>): Record<string, number>
  create(seed: number, participants: string[], options: Record<string, number>): { world: W }
  /**
   * `discrete` inputs are checked against the match window, fire once, and are
   * acknowledged. `continuous` inputs are applied in arrival order. Null drops a
   * malformed input. Discrete inputs carry a server-domain `at`.
   */
  classify(input: unknown): 'continuous' | 'discrete' | null
  apply(world: W, playerId: string, input: any): InputOutcome
  step(world: W): void
  /** Runs after each broadcast so per-frame accumulators can reset. */
  afterFrame?(world: W): void
  tick(world: W): number
  boardFrame(world: W, clock: Clock): object
  /** Null for a spectator. */
  playerFrame(world: W, playerId: string, clock: Clock): object | null
  results(world: W): MinigameResult[]
}

export function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
```

- [ ] **Step 5: Create `server/minigames/bow/definition.ts`**

The frame shapes are moved verbatim from the old `runtime.ts#frameFor`.

```ts
import type { BowInput } from '../../../shared/protocol.ts'
import { numberOption, type Clock, type MinigameDefinition } from '../definition.ts'
import { BOW_FIELD, BOW_STEP_MS, type BowPlayer, type BowWorld } from './types.ts'
import { bowResults, createBowWorld, releaseBow, sampleBowTrajectory, setBowAim, stepBow } from './world.ts'

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

const projectPlayer = (player: BowPlayer, clock: Clock) => ({
  id: player.id, origin: { ...player.origin }, aim: { ...player.aim }, score: player.score,
  reloadUntilMs: clock(player.reloadUntilMs),
})

export const bow: MinigameDefinition<BowWorld> = {
  stepMs: BOW_STEP_MS,
  options: (raw) => ({ reloadMs: numberOption(raw.reloadMs, 100, 0, 5_000) }),
  create: (seed, participants, options) => ({
    world: createBowWorld({ seed, playerIds: participants, config: { reloadMs: options.reloadMs } }),
  }),
  classify(input) {
    const i = input as { kind?: unknown; angle?: unknown; tension?: unknown; at?: unknown } | null
    if (i?.kind === 'aim') return finite(i.angle) && finite(i.tension) ? 'continuous' : null
    if (i?.kind === 'release') return finite(i.at) ? 'discrete' : null
    return null
  },
  apply(world, playerId, input: BowInput) {
    if (input.kind === 'aim') {
      setBowAim(world, playerId, { angle: input.angle, tension: input.tension })
      return { status: 'accepted' }
    }
    const result = releaseBow(world, playerId)
    if (result.status === 'accepted') return { status: 'accepted' }
    return { status: 'refused', reason: result.reason === 'unknown-player' ? 'not-participant' : result.reason }
  },
  step: stepBow,
  tick: (world) => world.tick,
  boardFrame: (world, clock) => ({
    field: BOW_FIELD,
    targets: world.targets.map((target) => ({ ...target, center: { ...target.center } })),
    players: Object.values(world.players).map((player) => projectPlayer(player, clock)),
    arrows: world.arrows.map((arrow) => ({
      id: arrow.id, playerId: arrow.playerId, position: { ...arrow.position }, angle: arrow.angle,
      state: arrow.state, tailKick: arrow.tailKick,
    })),
  }),
  playerFrame(world, playerId, clock) {
    if (!Object.hasOwn(world.players, playerId)) return null
    return { player: projectPlayer(world.players[playerId], clock), trajectory: sampleBowTrajectory(world, playerId, 18) }
  },
  results: bowResults,
}
```

- [ ] **Step 6: Create `server/minigames/registry.ts`**

```ts
import type { MinigameId } from '../../shared/protocol.ts'
import type { MinigameDefinition } from './definition.ts'
import { bow } from './bow/definition.ts'

export const MINIGAMES: Record<MinigameId, MinigameDefinition<any>> = { bow }
```

- [ ] **Step 7: Rewrite `server/minigames/runtime.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type {
  ActionResult, HostAction, MinigameFrame, MinigameInputAck, MinigameInputMsg, MinigameResult, Role, State,
} from '../../shared/protocol.ts'
import { numberOption, type MinigameDefinition } from './definition.ts'
import { MINIGAMES } from './registry.ts'

const COUNTDOWN_MS = 3_000
const LANDING_GRACE_MS = 3_000
const INPUT_GRACE_MS = 250
const FRAME_MS = 50
const MAX_STEPS_PER_PUMP = 8

type RuntimeAction = Extract<HostAction,
  { a: 'prepareMinigame' | 'startMinigame' | 'cancelMinigame' | 'closeMinigame' }>

type Hooks = {
  now?: () => number
  onState: (cause: string) => void
  onFrame: () => void
  onAck: (playerId: string, ack: MinigameInputAck) => void
  onComplete: (matchId: string, results: MinigameResult[]) => void
}

type Pending = { playerId: string; seq: number; input: unknown; discrete: boolean }

export class MinigameRuntime {
  private state: State
  private hooks: Hooks
  private world: unknown = null
  private readonly now: () => number
  private lastPump = 0
  private accumulator = 0
  private skippedMs = 0
  private lastFrame = 0
  private pending: Pending[] = []
  private dispositions = new Map<string, MinigameInputAck>()
  private completed = false

  constructor(state: State, hooks: Hooks) {
    this.state = state
    this.hooks = hooks
    this.now = hooks.now ?? Date.now
  }

  private definition(): MinigameDefinition<unknown> | null {
    const id = this.state.minigame?.id
    return id && Object.hasOwn(MINIGAMES, id) ? MINIGAMES[id] : null
  }

  host(action: RuntimeAction): ActionResult {
    if (action.a === 'prepareMinigame') {
      if (this.state.round.phase !== 'IDLE' || this.state.minigame?.phase === 'playing' || this.state.minigame?.phase === 'countdown') {
        return { status: 'refused', reason: 'not-idle' }
      }
      if (!Object.hasOwn(MINIGAMES, action.id)) return { status: 'refused', reason: 'unknown-mode' }
      const options = {
        ...MINIGAMES[action.id].options(action.options),
        durationSec: numberOption(action.options.durationSec, 40, 5, 180),
        seed: numberOption(action.options.seed, Math.floor(this.now()), 0, 2_147_483_647),
      }
      this.resetTransient()
      this.state.minigame = {
        id: action.id, matchId: randomUUID(), phase: 'ready', options, participants: [],
      }
      return { status: 'applied' }
    }

    const session = this.state.minigame
    const definition = this.definition()
    if (!session || !definition) return { status: 'unchanged' }

    if (action.a === 'startMinigame') {
      if (session.phase !== 'ready') return { status: 'unchanged' }
      const participants = this.state.players.filter((player) => player.connected).map((player) => player.id).sort()
      if (participants.length === 0) return { status: 'refused', reason: 'no-players' }
      const startsAt = this.now() + COUNTDOWN_MS
      session.matchId = randomUUID()
      session.phase = 'countdown'
      session.participants = participants
      session.startsAt = startsAt
      session.endsAt = startsAt + session.options.durationSec * 1_000
      delete session.results
      this.world = definition.create(session.options.seed, participants, session.options).world
      this.lastPump = startsAt
      this.lastFrame = 0
      this.skippedMs = 0
      this.completed = false
      return { status: 'applied' }
    }

    if (action.a === 'cancelMinigame') {
      if (session.phase === 'ready') return { status: 'unchanged' }
      this.resetTransient()
      this.state.minigame = {
        ...session, matchId: randomUUID(), phase: 'ready', participants: [],
        startsAt: undefined, endsAt: undefined, results: undefined,
      }
      return { status: 'applied' }
    }

    this.resetTransient()
    delete this.state.minigame
    return { status: 'applied' }
  }

  input(playerId: string, msg: MinigameInputMsg): void {
    const session = this.state.minigame
    const key = `${playerId}:${msg.seq}`
    const prior = this.dispositions.get(key)
    if (prior) {
      this.hooks.onAck(playerId, prior)
      return
    }
    const kind = this.definition()?.classify(msg.input) ?? null
    const refuse = (reason: NonNullable<MinigameInputAck['reason']>) => {
      if (kind !== 'discrete') return
      const ack: MinigameInputAck = { matchId: msg.matchId, seq: msg.seq, status: 'refused', reason }
      this.dispositions.set(key, ack)
      this.hooks.onAck(playerId, ack)
    }
    if (!session || msg.matchId !== session.matchId || !this.world) return refuse('stale-match')
    if (!session.participants.includes(playerId)) return refuse('not-participant')
    if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) return refuse('invalid')
    if (!kind) return
    if (kind === 'continuous') {
      this.pending.push({ playerId, seq: msg.seq, input: msg.input, discrete: false })
      return
    }

    const arrival = this.now()
    const at = (msg.input as { at: number }).at
    if (session.phase !== 'playing') return refuse('not-playing')
    if (arrival > (session.endsAt ?? 0) + INPUT_GRACE_MS || Math.min(arrival, Math.max(session.startsAt ?? 0, at)) > (session.endsAt ?? 0)) {
      return refuse('not-playing')
    }
    if (this.pending.some((item) => item.discrete && item.playerId === playerId && item.seq === msg.seq)) return
    this.pending.push({ playerId, seq: msg.seq, input: msg.input, discrete: true })
  }

  pump(): void {
    const session = this.state.minigame
    const definition = this.definition()
    if (!session || !definition || !this.world || !session.startsAt || !session.endsAt) return
    const now = this.now()
    if (session.phase === 'countdown') {
      if (now < session.startsAt) {
        if (now - this.lastFrame >= FRAME_MS) {
          this.lastFrame = now
          this.broadcast(definition)
        }
        return
      }
      session.phase = 'playing'
      this.lastPump = session.startsAt
      this.hooks.onState('minigame:playing')
    }
    if (session.phase !== 'playing') return

    const until = Math.min(now, session.endsAt + LANDING_GRACE_MS)
    this.accumulator += Math.max(0, until - this.lastPump)
    this.lastPump = until
    let steps = 0
    while (this.accumulator + 1e-9 >= definition.stepMs && steps < MAX_STEPS_PER_PUMP) {
      for (const item of this.pending.splice(0)) {
        const outcome = definition.apply(this.world, item.playerId, item.input)
        if (!item.discrete) continue
        const ack: MinigameInputAck = outcome.status === 'accepted'
          ? { matchId: session.matchId, seq: item.seq, status: 'accepted' }
          : { matchId: session.matchId, seq: item.seq, status: 'refused', reason: outcome.reason }
        this.dispositions.set(`${item.playerId}:${item.seq}`, ack)
        this.hooks.onAck(item.playerId, ack)
      }
      definition.step(this.world)
      this.accumulator -= definition.stepMs
      steps++
    }
    if (steps === MAX_STEPS_PER_PUMP && this.accumulator >= definition.stepMs) {
      const remainder = this.accumulator % definition.stepMs
      this.skippedMs += this.accumulator - remainder
      this.accumulator = remainder
    }
    this.broadcast(definition)
    if (!this.completed && now >= session.endsAt + LANDING_GRACE_MS) {
      this.completed = true
      this.hooks.onComplete(session.matchId, definition.results(this.world))
    }
  }

  frameFor(role: Role, playerId?: string): MinigameFrame | null {
    const session = this.state.minigame
    const definition = this.definition()
    const world = this.world
    if (!session || !definition || !world) return null
    const base = { id: session.id, matchId: session.matchId, tick: definition.tick(world), serverTime: this.now() }
    const clock = (worldMs: number) => session.startsAt! + this.skippedMs + worldMs
    if (role === 'board') return { ...base, role: 'board', ...definition.boardFrame(world, clock) } as MinigameFrame
    const player = playerId ? definition.playerFrame(world, playerId, clock) : null
    if (!player) return { ...base, role: 'spectator' } as MinigameFrame
    return { ...base, role: 'player', ...player } as MinigameFrame
  }

  finish(matchId: string, results: MinigameResult[]): boolean {
    const session = this.state.minigame
    if (!session || session.matchId !== matchId || session.phase !== 'playing') return false
    session.phase = 'results'
    session.results = results
    this.resetTransient(false)
    return true
  }

  stop(): void { this.resetTransient() }

  private broadcast(definition: MinigameDefinition<unknown>): void {
    this.hooks.onFrame()
    definition.afterFrame?.(this.world)
  }

  private resetTransient(clearCompleted = true): void {
    this.world = null
    this.pending = []
    this.dispositions.clear()
    this.accumulator = 0
    this.skippedMs = 0
    if (clearCompleted) this.completed = false
  }
}
```

- [ ] **Step 8: Run all tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all minigame tests pass including the new one; only the known pre-existing clip test fails.

- [ ] **Step 9: Record the deviations in the spec**

In `docs/superpowers/specs/2026-09-13-tank-battle-design.md`:
- "Crews are random pairs made at **Prepare**" → "made at **Start**, when participants are fixed".
- Board section: replace the `<canvas>` sentence with "Cover draws as one SVG path rebuilt when cover changes, inside the same viewBox as the rest of the field."
- Frames: replace "The full cover grid is sent at countdown and whenever a board connects." with "The full cover grid is sent on the first frame and then once per second."
- Tanks: add "Tanks collide and are hit as 22 px circles."

- [ ] **Step 10: Commit**

```bash
git add shared/protocol.ts server/minigames client/useSocket.ts client/BowPlayer.tsx server/hub.ts tools docs/superpowers/specs/2026-09-13-tank-battle-design.md
git commit -m "refactor: minigame registry with bow behind a definition"
```

---

### Task 2: Tank types and the cover grid

**Files:**
- Modify: `shared/protocol.ts` (add `TankCrew`), `server/minigames/bow/world.ts:18` (export `mulberry32`)
- Create: `server/minigames/tank/types.ts`, `server/minigames/tank/cover.ts`
- Test: `server/minigames/tank/cover.test.ts`

**Interfaces:**
- Consumes: `Vec2` from `server/minigames/bow/types.ts`; `mulberry32` from `server/minigames/bow/world.ts`.
- Produces: `TANK_STEP_MS`, `TANK_FIELD`, `CELL`, `COLS`, `ROWS`, `TANK_RADIUS`, `Weapon`, `WeaponConfig`, `TankConfig`, `Tank`, `Projectile`, `Blast`, `TankWorld` (types.ts); `SPAWNS`, `createCover(seed, spawns)`, `circleHitsCover(cover, center, radius)`, `carve(cover, center, radius): number[]`, `encodeCover(cover): string` (cover.ts); `TankCrew = { id: string; driver: PlayerId; gunner: PlayerId }` (protocol).

- [ ] **Step 1: Add shared and world types**

In `shared/protocol.ts`, beside the minigame types:

```ts
/** A solo crew uses the same player for both roles. */
export type TankCrew = { id: string; driver: PlayerId; gunner: PlayerId }
```

In `server/minigames/bow/world.ts` change `const mulberry32 =` to `export const mulberry32 =`.

Create `server/minigames/tank/types.ts`:

```ts
import type { TankCrew } from '../../../shared/protocol.ts'
import type { Vec2 } from '../bow/types.ts'

export const TANK_STEP_MS = 1000 / 60
export const TANK_FIELD = { width: 1600, height: 900 } as const
export const CELL = 10
export const COLS = 160
export const ROWS = 90
// ponytail: tanks collide and take hits as circles; use oriented boxes if glancing hits feel wrong.
export const TANK_RADIUS = 22

export type Weapon = 'gun' | 'cannon'

export type WeaponConfig = {
  damage: number
  clip: number
  /** Minimum time between shots while loaded. */
  intervalMs: number
  reloadMs: number
  blastRadius: number
  speed: number
  lifetimeMs: number
}

export type TankConfig = {
  hp: number
  forwardSpeed: number
  backwardSpeed: number
  radiansPerTurn: number
  /** Projectiles spawn this far along the gun from the tank center. */
  muzzle: number
  gun: WeaponConfig
  cannon: WeaponConfig
  /** Cannon splash damage at the blast center, falling to zero at its radius. */
  splash: number
  respawnMs: number
  invulnerableMs: number
  killPoints: number
}

export type Tank = {
  /** The crew id. */
  id: string
  crew: TankCrew
  position: Vec2
  /** Radians, 0 = +x, clockwise on screen. */
  hull: number
  /** Radians relative to the hull. */
  turret: number
  hp: number
  drive: -1 | 0 | 1
  gunHeld: boolean
  gunClip: number
  gunNextShotMs: number
  gunReloadUntilMs: number
  cannonClip: number
  cannonReloadUntilMs: number
  /** Set while destroyed. */
  deadUntilMs: number | null
  invulnerableUntilMs: number
  score: number
  shots: number
}

export type Projectile = {
  id: string
  tankId: string
  weapon: Weapon
  position: Vec2
  velocity: Vec2
  bornAtMs: number
}

export type Blast = { position: Vec2; radius: number; weapon: Weapon }

export type TankWorld = {
  seed: number
  tick: number
  nowMs: number
  nextProjectile: number
  config: TankConfig
  /** Row-major, 1 = solid cover. */
  cover: Uint8Array
  /** Cells cleared since the last broadcast. */
  coverChanged: number[]
  /** The first tick whose board frame carries the whole grid again. */
  nextFullCoverTick: number
  spawns: Vec2[]
  tanks: Tank[]
  projectiles: Projectile[]
  /** Explosions since the last broadcast. */
  blasts: Blast[]
}
```

- [ ] **Step 2: Write the failing tests**

Create `server/minigames/tank/cover.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { COLS, ROWS } from './types.ts'
import { SPAWNS, carve, circleHitsCover, createCover, encodeCover } from './cover.ts'

test('cover is seeded, point-symmetric, and leaves spawns clear', () => {
  const cover = createCover(7, SPAWNS)
  assert.deepEqual(cover, createCover(7, SPAWNS))
  assert.ok(cover.some((cell) => cell === 1))
  for (let i = 0; i < cover.length; i++) assert.equal(cover[i], cover[cover.length - 1 - i])
  for (const spawn of SPAWNS) assert.equal(circleHitsCover(cover, spawn, 40), false)
})

test('a circle hits a solid cell only when its edge reaches the cell', () => {
  const cover = new Uint8Array(COLS * ROWS)
  cover[10 * COLS + 10] = 1 // x 100..110, y 100..110
  assert.equal(circleHitsCover(cover, { x: 95, y: 105 }, 6), true)
  assert.equal(circleHitsCover(cover, { x: 95, y: 105 }, 4), false)
})

test('carving clears cells the blast touches and reports them', () => {
  const cover = new Uint8Array(COLS * ROWS).fill(1)
  const cleared = carve(cover, { x: 505, y: 505 }, 8)
  assert.ok(cleared.includes(50 * COLS + 50))
  assert.equal(cover[50 * COLS + 50], 0)
  assert.equal(cover[50 * COLS + 53], 1)
  assert.deepEqual(carve(cover, { x: 505, y: 505 }, 8), [], 'already clear cells are not reported twice')
})

test('the encoded grid is one digit per cell', () => {
  const cover = new Uint8Array(COLS * ROWS)
  cover[3] = 1
  const encoded = encodeCover(cover)
  assert.equal(encoded.length, COLS * ROWS)
  assert.equal(encoded.slice(0, 5), '00010')
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test server/minigames/tank/cover.test.ts`
Expected: FAIL, cannot find module `./cover.ts`.

- [ ] **Step 4: Implement `server/minigames/tank/cover.ts`**

```ts
import type { Vec2 } from '../bow/types.ts'
import { mulberry32 } from '../bow/world.ts'
import { CELL, COLS, ROWS } from './types.ts'

/** Point-symmetric pairs around the field center. */
export const SPAWNS: Vec2[] = [
  { x: 100, y: 100 }, { x: 1500, y: 800 },
  { x: 1500, y: 100 }, { x: 100, y: 800 },
  { x: 800, y: 100 }, { x: 800, y: 800 },
  { x: 100, y: 450 }, { x: 1500, y: 450 },
]

const SPAWN_CLEARANCE = 90

export function createCover(seed: number, spawns: Vec2[]): Uint8Array {
  const random = mulberry32(seed)
  const cover = new Uint8Array(COLS * ROWS)
  for (let cluster = 0; cluster < 7; cluster++) {
    const width = 4 + Math.floor(random() * 9)
    const height = 3 + Math.floor(random() * 8)
    const col = Math.floor(random() * (COLS - width))
    const row = Math.floor(random() * (ROWS - height))
    for (let r = row; r < row + height; r++) {
      for (let c = col; c < col + width; c++) {
        cover[r * COLS + c] = 1
        cover[(ROWS - 1 - r) * COLS + (COLS - 1 - c)] = 1
      }
    }
  }
  for (let i = 0; i < cover.length; i++) {
    const x = (i % COLS + 0.5) * CELL
    const y = (Math.floor(i / COLS) + 0.5) * CELL
    if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.y - y) < SPAWN_CLEARANCE)) cover[i] = 0
  }
  return cover
}

/** Indices of in-field cells whose rectangle the circle reaches. */
function cellsTouching(center: Vec2, radius: number): number[] {
  const cells: number[] = []
  const c0 = Math.max(0, Math.floor((center.x - radius) / CELL))
  const c1 = Math.min(COLS - 1, Math.floor((center.x + radius) / CELL))
  const r0 = Math.max(0, Math.floor((center.y - radius) / CELL))
  const r1 = Math.min(ROWS - 1, Math.floor((center.y + radius) / CELL))
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const nx = Math.max(c * CELL, Math.min(center.x, (c + 1) * CELL))
      const ny = Math.max(r * CELL, Math.min(center.y, (r + 1) * CELL))
      if (Math.hypot(center.x - nx, center.y - ny) < radius) cells.push(r * COLS + c)
    }
  }
  return cells
}

export function circleHitsCover(cover: Uint8Array, center: Vec2, radius: number): boolean {
  return cellsTouching(center, radius).some((index) => cover[index] === 1)
}

export function carve(cover: Uint8Array, center: Vec2, radius: number): number[] {
  const cleared = cellsTouching(center, radius).filter((index) => cover[index] === 1)
  for (const index of cleared) cover[index] = 0
  return cleared
}

export const encodeCover = (cover: Uint8Array): string => cover.join('')
```

- [ ] **Step 5: Run tests**

Run: `node --test server/minigames/tank/cover.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol.ts server/minigames/bow/world.ts server/minigames/tank
git commit -m "feat: tank world types and destructible cover grid"
```

---

### Task 3: Tank world — crews, controls, movement, firing

Projectiles are spawned here but do not fly yet; Task 4 adds flight, blasts and damage.

**Files:**
- Modify: `shared/protocol.ts` (add `TankInput`, widen `MinigameInputMsg.input`, add `'destroyed'` to `MinigameInputAck['reason']`)
- Create: `server/minigames/tank/world.ts`
- Test: `server/minigames/tank/world.test.ts`

**Interfaces:**
- Consumes: Task 2 types and cover functions; `mulberry32`.
- Produces: `DEFAULT_TANK_CONFIG`, `formCrews(random: () => number, participants: string[]): TankCrew[]`, `createTankWorld({ seed, crews, config?, cover? }): TankWorld`, `tankOf(world, playerId): Tank | undefined`, `gunDirection(tank): number`, `applyTankInput(world, playerId, input: TankInput): InputOutcome`, `stepTank(world): void`.

- [ ] **Step 1: Widen the wire types**

In `shared/protocol.ts`:

```ts
export type TankInput =
  | { kind: 'wheel'; turns: number; part?: 'hull' | 'turret' }
  | { kind: 'drive'; dir: -1 | 0 | 1 }
  | { kind: 'trigger'; weapon: 'gun' | 'cannon'; down: boolean; at: number }
```

Set `MinigameInputMsg.input` to `BowInput | TankInput`, and add `'destroyed'` to the `MinigameInputAck` reason union.

- [ ] **Step 2: Write the failing tests**

Create `server/minigames/tank/world.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { COLS, ROWS } from './types.ts'
import { applyTankInput, createTankWorld, formCrews, gunDirection, stepTank } from './world.ts'
import type { TankCrew } from '../../../shared/protocol.ts'

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not ${expected}`)

/** A world with no cover and every tank parked facing +x. */
function open(crews: TankCrew[], at = [{ x: 800, y: 450 }, { x: 1200, y: 450 }]) {
  const world = createTankWorld({ seed: 1, crews, cover: new Uint8Array(COLS * ROWS) })
  world.tanks.forEach((tank, index) => { tank.position = { ...at[index] }; tank.hull = 0; tank.turret = 0 })
  return world
}
const steps = (world: ReturnType<typeof open>, count: number) => { for (let i = 0; i < count; i++) stepTank(world) }
const DG: TankCrew = { id: 'crew-0', driver: 'd', gunner: 'g' }

test('crews pair every participant once, with one solo crew for an odd count', () => {
  const crews = formCrews(mulberry32(3), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(crews.length, 3)
  assert.equal(crews.filter((crew) => crew.driver === crew.gunner).length, 1)
  assert.deepEqual([...new Set(crews.flatMap((crew) => [crew.driver, crew.gunner]))].sort(), ['a', 'b', 'c', 'd', 'e'])
})

test('the gun turns with the hull, so the driver moves the gunner\'s aim', () => {
  const world = open([DG])
  const tank = world.tanks[0]
  assert.deepEqual(applyTankInput(world, 'g', { kind: 'wheel', turns: 0.5 }), { status: 'accepted' })
  close(tank.turret, Math.PI / 4)
  assert.equal(tank.hull, 0)
  applyTankInput(world, 'd', { kind: 'wheel', turns: 1 })
  close(tank.hull, Math.PI / 2)
  close(tank.turret, Math.PI / 4)
  close(gunDirection(tank), 3 * Math.PI / 4)
})

test('endless spinning keeps angles bounded', () => {
  const world = open([DG])
  for (let i = 0; i < 100; i++) applyTankInput(world, 'd', { kind: 'wheel', turns: 0.9 })
  assert.ok(Math.abs(world.tanks[0].hull) <= Math.PI)
})

test('a solo crew names which part its wheel turns', () => {
  const world = open([{ id: 'crew-0', driver: 's', gunner: 's' }])
  assert.deepEqual(applyTankInput(world, 's', { kind: 'wheel', turns: 1 }), { status: 'refused', reason: 'invalid' })
  applyTankInput(world, 's', { kind: 'wheel', turns: 1, part: 'turret' })
  close(world.tanks[0].turret, Math.PI / 2)
})

test('only the driver drives: 160 px/s forward, 100 px/s back', () => {
  const world = open([DG])
  assert.deepEqual(applyTankInput(world, 'g', { kind: 'drive', dir: 1 }), { status: 'refused', reason: 'invalid' })
  applyTankInput(world, 'd', { kind: 'drive', dir: 1 })
  steps(world, 60)
  close(world.tanks[0].position.x, 960, 1e-6)
  applyTankInput(world, 'd', { kind: 'drive', dir: -1 })
  steps(world, 60)
  close(world.tanks[0].position.x, 860, 1e-6)
})

test('cover and other tanks block movement', () => {
  const world = open([DG, { id: 'crew-1', driver: 'x', gunner: 'y' }], [{ x: 800, y: 450 }, { x: 800, y: 300 }])
  for (let row = 0; row < ROWS; row++) world.cover[row * COLS + 85] = 1 // wall at x 850..860
  applyTankInput(world, 'd', { kind: 'drive', dir: 1 })
  steps(world, 120)
  const tank = world.tanks[0]
  assert.ok(tank.position.x <= 828 && tank.position.x > 820, `stopped at ${tank.position.x}`)

  world.tanks[1].position = { x: 700, y: 300 }
  tank.position = { x: 600, y: 300 }
  steps(world, 120)
  assert.ok(Math.hypot(700 - tank.position.x, 0) >= 44 - 1e-9)
})

test('holding the gun fires 10 rounds a second, then reloads 2 s after the clip empties', () => {
  const world = open([DG])
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  steps(world, 60)
  assert.equal(world.tanks[0].shots, 10)
  steps(world, 174) // tick 234: the 20th round fired at tick 115
  assert.equal(world.tanks[0].shots, 20)
  assert.equal(world.tanks[0].gunClip, 0)
  steps(world, 1)
  assert.equal(world.tanks[0].shots, 21)
})

test('the cannon fires once per tap and refuses taps for 3 s', () => {
  const world = open([DG])
  const tap = { kind: 'trigger', weapon: 'cannon', down: true, at: 0 } as const
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', { ...tap, down: false }), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'refused', reason: 'reloading' })
  steps(world, 180)
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.equal(world.tanks[0].shots, 2)
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test server/minigames/tank/world.test.ts`
Expected: FAIL, cannot find module `./world.ts`.

- [ ] **Step 4: Implement `server/minigames/tank/world.ts`**

```ts
import type { TankCrew, TankInput } from '../../../shared/protocol.ts'
import type { Vec2 } from '../bow/types.ts'
import type { InputOutcome } from '../definition.ts'
import { SPAWNS, circleHitsCover, createCover } from './cover.ts'
import { TANK_FIELD, TANK_RADIUS, TANK_STEP_MS } from './types.ts'
import type { Tank, TankConfig, TankWorld, Weapon } from './types.ts'

export const DEFAULT_TANK_CONFIG: Readonly<TankConfig> = {
  hp: 100,
  forwardSpeed: 160,
  backwardSpeed: 100,
  radiansPerTurn: Math.PI / 2,
  muzzle: 30,
  gun: { damage: 5, clip: 20, intervalMs: 100, reloadMs: 2_000, blastRadius: 8, speed: 900, lifetimeMs: 1_500 },
  cannon: { damage: 30, clip: 1, intervalMs: 0, reloadMs: 3_000, blastRadius: 40, speed: 600, lifetimeMs: 2_500 },
  splash: 20,
  respawnMs: 3_000,
  invulnerableMs: 2_000,
  killPoints: 50,
}

// Tick times are multiples of a repeating fraction; compare deadlines with a tolerance.
const reached = (world: TankWorld, ms: number) => world.nowMs + 1e-6 >= ms
const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))

export function formCrews(random: () => number, participants: string[]): TankCrew[] {
  const order = [...participants].sort()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const crews: TankCrew[] = []
  for (let i = 0; i < order.length; i += 2) {
    crews.push({ id: `crew-${i / 2}`, driver: order[i], gunner: order[i + 1] ?? order[i] })
  }
  return crews
}

// ponytail: more than 8 tanks reuse spawn points shifted sideways; add spawns if rooms get that big.
export function spawnPoint(spawns: Vec2[], index: number): Vec2 {
  const base = spawns[index % spawns.length]
  const lap = Math.floor(index / spawns.length)
  return { x: base.x + lap * 60 * (base.x < TANK_FIELD.width / 2 ? 1 : -1), y: base.y }
}

export const facingCenter = (p: Vec2) => Math.atan2(TANK_FIELD.height / 2 - p.y, TANK_FIELD.width / 2 - p.x)

export function createTankWorld(input: {
  seed: number
  crews: TankCrew[]
  config?: Partial<TankConfig>
  cover?: Uint8Array
}): TankWorld {
  const config = { ...DEFAULT_TANK_CONFIG, ...input.config }
  const tanks: Tank[] = input.crews.map((crew, index) => {
    const position = spawnPoint(SPAWNS, index)
    return {
      id: crew.id, crew, position, hull: facingCenter(position), turret: 0, hp: config.hp,
      drive: 0, gunHeld: false,
      gunClip: config.gun.clip, gunNextShotMs: 0, gunReloadUntilMs: 0,
      cannonClip: config.cannon.clip, cannonReloadUntilMs: 0,
      deadUntilMs: null, invulnerableUntilMs: 0, score: 0, shots: 0,
    }
  })
  return {
    seed: input.seed, tick: 0, nowMs: 0, nextProjectile: 0, config,
    cover: input.cover ?? createCover(input.seed, SPAWNS),
    coverChanged: [], nextFullCoverTick: 0, spawns: SPAWNS,
    tanks, projectiles: [], blasts: [],
  }
}

export const tankOf = (world: TankWorld, playerId: string) =>
  world.tanks.find((tank) => tank.crew.driver === playerId || tank.crew.gunner === playerId)

export const gunDirection = (tank: Tank) => tank.hull + tank.turret

export function applyTankInput(world: TankWorld, playerId: string, input: TankInput): InputOutcome {
  const tank = tankOf(world, playerId)
  if (!tank) return { status: 'refused', reason: 'not-participant' }
  const driver = tank.crew.driver === playerId
  const gunner = tank.crew.gunner === playerId

  if (input.kind === 'wheel') {
    const part = driver && gunner ? input.part : driver ? 'hull' : 'turret'
    if (part !== 'hull' && part !== 'turret') return { status: 'refused', reason: 'invalid' }
    const radians = Math.max(-4, Math.min(4, input.turns)) * world.config.radiansPerTurn
    tank[part] = wrap(tank[part] + radians)
    return { status: 'accepted' }
  }
  if (input.kind === 'drive') {
    if (!driver) return { status: 'refused', reason: 'invalid' }
    tank.drive = input.dir
    return { status: 'accepted' }
  }
  if (!gunner) return { status: 'refused', reason: 'invalid' }
  if (input.weapon === 'gun') {
    tank.gunHeld = input.down
    return { status: 'accepted' }
  }
  if (!input.down) return { status: 'accepted' }
  if (tank.deadUntilMs !== null) return { status: 'refused', reason: 'destroyed' }
  if (tank.cannonClip === 0) return { status: 'refused', reason: 'reloading' }
  fire(world, tank, 'cannon')
  return { status: 'accepted' }
}

function fire(world: TankWorld, tank: Tank, weapon: Weapon): void {
  const spec = world.config[weapon]
  const angle = gunDirection(tank)
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  world.projectiles.push({
    id: `shot-${world.nextProjectile++}`,
    tankId: tank.id,
    weapon,
    position: { x: tank.position.x + dir.x * world.config.muzzle, y: tank.position.y + dir.y * world.config.muzzle },
    velocity: { x: dir.x * spec.speed, y: dir.y * spec.speed },
    bornAtMs: world.nowMs,
  })
  tank.shots++
  if (weapon === 'gun') {
    tank.gunClip--
    tank.gunNextShotMs = world.nowMs + spec.intervalMs
    if (tank.gunClip === 0) tank.gunReloadUntilMs = world.nowMs + spec.reloadMs
  } else {
    tank.cannonClip--
    tank.cannonReloadUntilMs = world.nowMs + spec.reloadMs
  }
}

function reload(world: TankWorld, tank: Tank): void {
  if (tank.gunClip === 0 && reached(world, tank.gunReloadUntilMs)) tank.gunClip = world.config.gun.clip
  if (tank.cannonClip === 0 && reached(world, tank.cannonReloadUntilMs)) tank.cannonClip = world.config.cannon.clip
}

function blocked(world: TankWorld, tank: Tank, next: Vec2): boolean {
  const r = TANK_RADIUS
  if (next.x < r || next.y < r || next.x > TANK_FIELD.width - r || next.y > TANK_FIELD.height - r) return true
  if (circleHitsCover(world.cover, next, r)) return true
  // An overlapping pair may still move apart, so a respawn on top of a tank never locks both.
  return world.tanks.some((other) => {
    if (other === tank || other.deadUntilMs !== null) return false
    const after = Math.hypot(other.position.x - next.x, other.position.y - next.y)
    return after < 2 * r && after < Math.hypot(other.position.x - tank.position.x, other.position.y - tank.position.y)
  })
}

function move(world: TankWorld, tank: Tank, dt: number): void {
  if (tank.drive === 0) return
  const speed = tank.drive > 0 ? world.config.forwardSpeed : -world.config.backwardSpeed
  const dx = Math.cos(tank.hull) * speed * dt
  const dy = Math.sin(tank.hull) * speed * dt
  const { x, y } = tank.position
  // Slide along whatever blocks one axis.
  for (const next of [{ x: x + dx, y: y + dy }, { x: x + dx, y }, { x, y: y + dy }]) {
    if (!blocked(world, tank, next)) {
      tank.position = next
      return
    }
  }
}

export function stepTank(world: TankWorld): void {
  const dt = TANK_STEP_MS / 1000
  world.tick++
  world.nowMs = world.tick * TANK_STEP_MS
  for (const tank of world.tanks) {
    reload(world, tank)
    if (tank.deadUntilMs !== null) continue
    move(world, tank, dt)
    if (tank.gunHeld && tank.gunClip > 0 && reached(world, tank.gunNextShotMs)) fire(world, tank, 'gun')
  }
}
```

- [ ] **Step 5: Run tests**

Run: `node --test server/minigames/tank/world.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol.ts server/minigames/tank
git commit -m "feat: tank crews, wheel and drive controls, movement and firing"
```

---

### Task 4: Tank combat — flight, blasts, damage, respawn, results

**Files:**
- Modify: `server/minigames/tank/cover.ts` (add `solidAt`), `server/minigames/tank/world.ts`
- Test: `server/minigames/tank/world.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 world functions; `carve`.
- Produces: `solidAt(cover, p): boolean`; `tankResults(world): MinigameResult[]`; `stepTank` now flies projectiles, fills `world.blasts` and `world.coverChanged`, applies damage and respawns.

- [ ] **Step 1: Write the failing tests**

Add `tankResults` to the `./world.ts` import in `world.test.ts`, then append:

```ts
const YZ: TankCrew = { id: 'crew-1', driver: 'y', gunner: 'z' }
const pullGun = (world: ReturnType<typeof open>) => {
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  stepTank(world)
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: false, at: 0 })
}
const cannon = (world: ReturnType<typeof open>) =>
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'cannon', down: true, at: 0 })

test('a gun round hits the first tank on its path for 5', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  pullGun(world)
  steps(world, 20)
  assert.equal(world.tanks[1].hp, 95)
  assert.equal(world.tanks[0].score, 5)
  assert.equal(world.projectiles.length, 0)
  assert.deepEqual(world.blasts.map((blast) => blast.weapon), ['gun'])
})

test('cover stops a shell, and the blast carves it', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  for (let row = 0; row < ROWS; row++) world.cover[row * COLS + 90] = 1 // x 900..910
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 100)
  assert.equal(world.cover[45 * COLS + 90], 0)
  assert.ok(world.coverChanged.includes(45 * COLS + 90))
  assert.deepEqual(world.blasts.map((blast) => blast.radius), [40])
})

test('a direct cannon hit does 30 with no extra splash', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 70)
  assert.equal(world.tanks[0].score, 30)
})

test('cannon splash falls off with distance', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 480 }])
  world.cover[45 * COLS + 100] = 1 // x 1000..1010, y 450..460: the shell bursts 8 px from the tank's edge
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 84)
  assert.equal(world.tanks[0].score, 16)
})

test('splash hurts the firing tank and scores nothing', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1400, y: 800 }])
  world.cover[45 * COLS + 83] = 1 // right at the muzzle
  cannon(world)
  stepTank(world)
  assert.ok(world.tanks[0].hp < 100 && world.tanks[0].hp > 80, `hp ${world.tanks[0].hp}`)
  assert.equal(world.tanks[0].score, 0)
})

test('a kill scores 50; the tank respawns after 3 s far from enemies, briefly invulnerable', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  const target = world.tanks[1]
  target.hp = 5
  pullGun(world)
  while (target.deadUntilMs === null) stepTank(world)
  assert.equal(world.tanks[0].score, 55)
  steps(world, 179)
  assert.notEqual(target.deadUntilMs, null)
  stepTank(world)
  assert.equal(target.deadUntilMs, null)
  assert.equal(target.hp, 100)
  assert.deepEqual(target.position, { x: 100, y: 100 })
  close(target.invulnerableUntilMs, world.nowMs + 2_000, 1e-6)

  target.position = { x: 1000, y: 450 }
  pullGun(world)
  steps(world, 20)
  assert.equal(target.hp, 100, 'invulnerable tanks take no damage')
})

test('results give each crew member the crew score, and a solo player once', () => {
  const world = open([DG, { id: 'crew-1', driver: 's', gunner: 's' }])
  world.tanks[0].score = 40
  world.tanks[1].score = 70
  assert.deepEqual(tankResults(world).map((result) => [result.playerId, result.points]), [
    ['s', 70], ['d', 40], ['g', 40],
  ])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/minigames/tank/world.test.ts`
Expected: the new tests FAIL (`tankResults` missing; no damage applied).

- [ ] **Step 3: Add `solidAt` to `cover.ts`**

```ts
/** False outside the field; edges are handled by their callers. */
export function solidAt(cover: Uint8Array, p: Vec2): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= COLS * CELL || p.y >= ROWS * CELL) return false
  return cover[Math.floor(p.y / CELL) * COLS + Math.floor(p.x / CELL)] === 1
}
```

- [ ] **Step 4: Add combat to `world.ts`**

Update imports:

```ts
import type { MinigameResult, TankCrew, TankInput } from '../../../shared/protocol.ts'
import { SPAWNS, carve, circleHitsCover, createCover, solidAt } from './cover.ts'
import type { Projectile, Tank, TankConfig, TankWorld, Weapon } from './types.ts'
```

Add these functions:

```ts
function damage(world: TankWorld, shooter: Tank, victim: Tank, amount: number): void {
  if (amount <= 0 || victim.deadUntilMs !== null || world.nowMs < victim.invulnerableUntilMs) return
  const dealt = Math.min(amount, victim.hp)
  victim.hp -= dealt
  if (shooter !== victim) shooter.score += dealt
  if (victim.hp > 0) return
  victim.deadUntilMs = world.nowMs + world.config.respawnMs
  if (shooter !== victim) shooter.score += world.config.killPoints
}

function explode(world: TankWorld, at: Vec2, shot: Projectile, direct: Tank | undefined): void {
  const spec = world.config[shot.weapon]
  world.coverChanged.push(...carve(world.cover, at, spec.blastRadius))
  world.blasts.push({ position: { ...at }, radius: spec.blastRadius, weapon: shot.weapon })
  const shooter = world.tanks.find((tank) => tank.id === shot.tankId)!
  if (direct) damage(world, shooter, direct, spec.damage)
  if (shot.weapon !== 'cannon') return
  for (const tank of world.tanks) {
    if (tank === direct) continue
    const reach = Math.max(0, Math.hypot(tank.position.x - at.x, tank.position.y - at.y) - TANK_RADIUS)
    if (reach < spec.blastRadius) damage(world, shooter, tank, Math.round(world.config.splash * (1 - reach / spec.blastRadius)))
  }
}

function flyProjectiles(world: TankWorld, dt: number): void {
  const flying: Projectile[] = []
  for (const shot of world.projectiles) {
    if (reached(world, shot.bornAtMs + world.config[shot.weapon].lifetimeMs)) {
      explode(world, shot.position, shot, undefined)
      continue
    }
    // ponytail: point samples every 4 px, not a swept test; enough for 22 px tanks and 10 px cells.
    const samples = Math.max(1, Math.ceil(Math.hypot(shot.velocity.x, shot.velocity.y) * dt / 4))
    let burst = false
    for (let i = 1; i <= samples && !burst; i++) {
      const p = { x: shot.position.x + shot.velocity.x * dt * i / samples, y: shot.position.y + shot.velocity.y * dt * i / samples }
      const outside = p.x < 0 || p.y < 0 || p.x >= TANK_FIELD.width || p.y >= TANK_FIELD.height
      const hit = world.tanks.find((tank) => tank.id !== shot.tankId && tank.deadUntilMs === null
        && Math.hypot(tank.position.x - p.x, tank.position.y - p.y) < TANK_RADIUS)
      if (outside || hit || solidAt(world.cover, p)) {
        const at = { x: Math.max(0, Math.min(TANK_FIELD.width - 1e-6, p.x)), y: Math.max(0, Math.min(TANK_FIELD.height - 1e-6, p.y)) }
        explode(world, at, shot, hit)
        burst = true
      }
    }
    if (!burst) {
      shot.position = { x: shot.position.x + shot.velocity.x * dt, y: shot.position.y + shot.velocity.y * dt }
      flying.push(shot)
    }
  }
  world.projectiles = flying
}

function respawn(world: TankWorld, tank: Tank): void {
  if (tank.deadUntilMs === null || !reached(world, tank.deadUntilMs)) return
  const enemies = world.tanks.filter((other) => other !== tank && other.deadUntilMs === null)
  const clearance = (p: Vec2) => enemies.length === 0 ? 0
    : Math.min(...enemies.map((enemy) => Math.hypot(enemy.position.x - p.x, enemy.position.y - p.y)))
  const spot = world.spawns.reduce((best, spawn) => clearance(spawn) > clearance(best) ? spawn : best)
  const { config } = world
  Object.assign(tank, {
    position: { ...spot }, hull: facingCenter(spot), turret: 0, hp: config.hp,
    gunClip: config.gun.clip, gunNextShotMs: 0, gunReloadUntilMs: 0,
    cannonClip: config.cannon.clip, cannonReloadUntilMs: 0,
    deadUntilMs: null, invulnerableUntilMs: world.nowMs + config.invulnerableMs,
  })
}

export function tankResults(world: TankWorld): MinigameResult[] {
  return world.tanks
    .flatMap((tank) => [...new Set([tank.crew.driver, tank.crew.gunner])]
      .map((playerId) => ({ playerId, points: tank.score, shots: tank.shots })))
    .sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : 1))
}
```

Replace `stepTank`:

```ts
export function stepTank(world: TankWorld): void {
  const dt = TANK_STEP_MS / 1000
  world.tick++
  world.nowMs = world.tick * TANK_STEP_MS
  for (const tank of world.tanks) {
    respawn(world, tank)
    reload(world, tank)
    if (tank.deadUntilMs !== null) continue
    move(world, tank, dt)
    if (tank.gunHeld && tank.gunClip > 0 && reached(world, tank.gunNextShotMs)) fire(world, tank, 'gun')
  }
  flyProjectiles(world, dt)
}
```

- [ ] **Step 5: Run tests**

Run: `node --test server/minigames/tank/*.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. If the splash test's exact 84/16 is off by one, check that the burst point is x = 1000 (the cell's left edge sampled at 4 px steps can land up to 4 px inside); widen the assertion to `hp` 83–85 rather than changing the falloff formula.

- [ ] **Step 6: Commit**

```bash
git add server/minigames/tank
git commit -m "feat: tank projectiles, blasts, damage, respawn and results"
```

---

### Task 5: Tank definition, frames, and a runtime match

**Files:**
- Modify: `shared/protocol.ts` (`MinigameId`, `MinigameState.crews`, tank frames)
- Modify: `server/minigames/definition.ts` (`create` may return crews), `server/minigames/runtime.ts` (store crews), `server/minigames/registry.ts`, `server/snapshot.ts:47-58,80`
- Modify: `server/minigames/tank/types.ts`, `server/minigames/tank/world.ts` (cease fire at the deadline)
- Create: `server/minigames/tank/definition.ts`
- Modify: `client/BowBoard.tsx:21`, `client/BowPlayer.tsx:13`, `server/minigames/runtime.test.ts`, `server/minigame.integration.test.ts:31`
- Test: `server/minigames/runtime.test.ts`, `server/minigames/tank/world.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `MinigameId = 'bow' | 'tank'`; `MinigameState.crews?: TankCrew[]`; frame types `TankFrameTank`, `TankFrameWeapon`, and tank board/player variants of `MinigameFrame` (fields below); `TankConfig.ceaseFireMs`; `tank` definition.

- [ ] **Step 1: Protocol**

In `shared/protocol.ts`:

```ts
export type MinigameId = 'bow' | 'tank'
```

Add `crews?: TankCrew[]` to `MinigameState`. Replace the `BowFrameBase` / `MinigameFrame` block with:

```ts
type FrameBase<Id extends MinigameId> = { id: Id; matchId: string; tick: number; serverTime: number }

export type TankFrameTank = {
  id: string
  crew: TankCrew
  position: { x: number; y: number }
  /** Radians, 0 = +x, clockwise. */
  hull: number
  /** Radians relative to the hull. */
  turret: number
  hp: number
  dead: boolean
  invulnerable: boolean
  score: number
}

/** `reloadUntil` is server time; the weapon is reloading while now is before it. */
export type TankFrameWeapon = { clip: number; size: number; reloadUntil: number; reloadMs: number }

export type MinigameFrame =
  | (FrameBase<'bow'> & {
      role: 'board'
      field: { width: number; height: number }
      targets: { id: string; center: { x: number; y: number }; radius: number }[]
      players: BowFramePlayer[]
      arrows: BowFrameArrow[]
    })
  | (FrameBase<'bow'> & { role: 'player'; player: BowFramePlayer; trajectory: { x: number; y: number }[] })
  | (FrameBase<'tank'> & {
      role: 'board'
      field: { width: number; height: number }
      /** One '0'/'1' digit per cell, row-major; present on the first frame and once a second. */
      cover?: string
      /** Cells cleared since the previous frame. */
      coverChanged: number[]
      tanks: TankFrameTank[]
      projectiles: { id: string; weapon: 'gun' | 'cannon'; position: { x: number; y: number } }[]
      /** Explosions since the previous frame. */
      blasts: { position: { x: number; y: number }; radius: number; weapon: 'gun' | 'cannon' }[]
    })
  | (FrameBase<'tank'> & {
      role: 'player'
      crew: TankCrew
      tank: TankFrameTank & { respawnAt: number | null; gun: TankFrameWeapon; cannon: TankFrameWeapon }
    })
  | (FrameBase<MinigameId> & { role: 'spectator' })
```

- [ ] **Step 2: Narrow existing bow consumers by id**

- `client/BowBoard.tsx:21`: `frame?.role === 'board' && frame.id === 'bow' && frame.matchId === session.matchId`
- `client/BowPlayer.tsx:13`: `frame?.matchId === session.matchId && frame.role === 'player' && frame.id === 'bow' ? frame : null`
- `server/minigames/runtime.test.ts`: each `if (x?.role === 'board')` / `if (x?.role === 'player')` guard gains `&& x.id === 'bow'`.
- `server/minigame.integration.test.ts:31`: `if (frame?.role === 'board' && frame.id === 'bow')`.
- In `client/BowBoard.tsx` change `type BoardFrame = Extract<MinigameFrame, { role: 'board' }>` to `Extract<MinigameFrame, { role: 'board'; id: 'bow' }>`.

- [ ] **Step 3: Write the failing tests**

Append to `server/minigames/tank/world.test.ts`:

```ts
test('weapons fall silent at the match deadline while tanks can still move', () => {
  const world = createTankWorld({ seed: 1, crews: [DG], cover: new Uint8Array(COLS * ROWS), config: { ceaseFireMs: 50 } })
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  steps(world, 10)
  assert.equal(world.tanks[0].shots, 1)
  assert.deepEqual(
    applyTankInput(world, 'g', { kind: 'trigger', weapon: 'cannon', down: true, at: 0 }),
    { status: 'refused', reason: 'not-playing' },
  )
})
```

Append to `server/minigames/runtime.test.ts`:

```ts
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
  r.runtime.input(gunner, { t: 'minigameInput', matchId: session.matchId, seq: 1, input: { kind: 'wheel', turns: 0.25 } })
  r.runtime.input(gunner, { t: 'minigameInput', matchId: session.matchId, seq: 2, input: { kind: 'trigger', weapon: 'cannon', down: true, at: session.startsAt! } })
  r.advance(17)
  assert.deepEqual(r.acks.at(-1), { matchId: session.matchId, seq: 2, status: 'accepted' })
  const mine = r.runtime.frameFor('player', gunner)
  assert.ok(mine?.role === 'player' && mine.id === 'tank')
  if (mine?.role === 'player' && mine.id === 'tank') {
    assert.equal(mine.tank.cannon.clip, 0)
    assert.ok(mine.tank.cannon.reloadUntil > mine.serverTime)
  }

  r.setNow(session.endsAt! + 3_000)
  r.runtime.pump()
  const { results } = r.completions[0] as { results: { playerId: string }[] }
  assert.deepEqual(results.map((result) => result.playerId).sort(), ['ada', 'bo'])
})
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test server/minigames/runtime.test.ts server/minigames/tank/world.test.ts`
Expected: the two new tests FAIL (`unknown-mode`; `ceaseFireMs` ignored).

- [ ] **Step 5: Cease fire at the deadline**

In `tank/types.ts` add to `TankConfig`:

```ts
  /** World time after which no weapon fires; the landing grace still runs. */
  ceaseFireMs: number
```

In `tank/world.ts`: add `ceaseFireMs: Infinity` to `DEFAULT_TANK_CONFIG`; in `applyTankInput` before the `deadUntilMs` check add

```ts
  if (world.nowMs >= world.config.ceaseFireMs) return { status: 'refused', reason: 'not-playing' }
```

and in `stepTank` change the gun condition to

```ts
    if (tank.gunHeld && tank.gunClip > 0 && world.nowMs < world.config.ceaseFireMs && reached(world, tank.gunNextShotMs)) fire(world, tank, 'gun')
```

- [ ] **Step 6: Let a definition return crews**

In `server/minigames/definition.ts` import `TankCrew` and change `create` to return `{ world: W; crews?: TankCrew[] }`.

In `runtime.ts#host` start branch replace the `this.world = …` line with:

```ts
      const created = definition.create(session.options.seed, participants, session.options)
      this.world = created.world
      if (created.crews) session.crews = created.crews
      else delete session.crews
```

In the cancel branch add `crews: undefined` beside `results: undefined`. In `server/snapshot.ts` add `crews: undefined` to both reset objects (lines 47–58 and 80).

- [ ] **Step 7: Create `server/minigames/tank/definition.ts`**

```ts
import type { TankInput } from '../../../shared/protocol.ts'
import type { Clock, MinigameDefinition } from '../definition.ts'
import { encodeCover } from './cover.ts'
import { TANK_FIELD, TANK_STEP_MS, type Tank, type TankWorld, type Weapon } from './types.ts'
import { applyTankInput, createTankWorld, formCrews, stepTank, tankOf, tankResults } from './world.ts'

const FULL_COVER_EVERY_TICKS = 60
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

const projectTank = (world: TankWorld, tank: Tank) => ({
  id: tank.id, crew: tank.crew, position: { ...tank.position }, hull: tank.hull, turret: tank.turret,
  hp: tank.hp, dead: tank.deadUntilMs !== null, invulnerable: world.nowMs < tank.invulnerableUntilMs, score: tank.score,
})

const projectWeapon = (world: TankWorld, tank: Tank, weapon: Weapon, clock: Clock) => ({
  clip: weapon === 'gun' ? tank.gunClip : tank.cannonClip,
  size: world.config[weapon].clip,
  reloadUntil: clock(weapon === 'gun' ? tank.gunReloadUntilMs : tank.cannonReloadUntilMs),
  reloadMs: world.config[weapon].reloadMs,
})

export const tank: MinigameDefinition<TankWorld> = {
  stepMs: TANK_STEP_MS,
  options: () => ({}),
  create(seed, participants, options) {
    // Crews reshuffle on every start, while the seeded map stays the same for a replay.
    const crews = formCrews(Math.random, participants)
    return { world: createTankWorld({ seed, crews, config: { ceaseFireMs: options.durationSec * 1_000 } }), crews }
  },
  classify(input) {
    const i = input as { kind?: unknown; turns?: unknown; part?: unknown; dir?: unknown; weapon?: unknown; down?: unknown; at?: unknown } | null
    if (i?.kind === 'wheel') return finite(i.turns) && (i.part === undefined || i.part === 'hull' || i.part === 'turret') ? 'continuous' : null
    if (i?.kind === 'drive') return i.dir === -1 || i.dir === 0 || i.dir === 1 ? 'continuous' : null
    if (i?.kind === 'trigger') {
      return (i.weapon === 'gun' || i.weapon === 'cannon') && typeof i.down === 'boolean' && finite(i.at) ? 'discrete' : null
    }
    return null
  },
  apply: (world, playerId, input: TankInput) => applyTankInput(world, playerId, input),
  step: stepTank,
  afterFrame(world) {
    world.coverChanged = []
    world.blasts = []
    if (world.tick >= world.nextFullCoverTick) world.nextFullCoverTick = world.tick + FULL_COVER_EVERY_TICKS
  },
  tick: (world) => world.tick,
  boardFrame: (world) => ({
    field: TANK_FIELD,
    ...(world.tick >= world.nextFullCoverTick ? { cover: encodeCover(world.cover) } : {}),
    coverChanged: [...world.coverChanged],
    tanks: world.tanks.map((tank) => projectTank(world, tank)),
    projectiles: world.projectiles.map((shot) => ({ id: shot.id, weapon: shot.weapon, position: { ...shot.position } })),
    blasts: world.blasts.map((blast) => ({ ...blast, position: { ...blast.position } })),
  }),
  playerFrame(world, playerId, clock) {
    const mine = tankOf(world, playerId)
    if (!mine) return null
    return {
      crew: mine.crew,
      tank: {
        ...projectTank(world, mine),
        respawnAt: mine.deadUntilMs === null ? null : clock(mine.deadUntilMs),
        gun: projectWeapon(world, mine, 'gun', clock),
        cannon: projectWeapon(world, mine, 'cannon', clock),
      },
    }
  },
  results: tankResults,
}
```

In `registry.ts`:

```ts
import { tank } from './tank/definition.ts'

export const MINIGAMES: Record<MinigameId, MinigameDefinition<any>> = { bow, tank }
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all minigame tests pass; only the known clip test fails.

- [ ] **Step 9: Commit**

```bash
git add shared/protocol.ts server client/BowBoard.tsx client/BowPlayer.tsx
git commit -m "feat: tank minigame definition, frames and crews in session state"
```

---

### Task 6: Tank phone controls

**Files:**
- Create: `client/tank-control.ts`, `client/tank-control.test.ts`, `client/TankPlayer.tsx`, `client/minigames.tsx`
- Modify: `client/Player.tsx:11,191`, `client/BowPlayer.tsx:5-11` (shared props type), `client/style.css` (after the bow block, line ~50)

**Interfaces:**
- Consumes: `TankFrameWeapon`, `TankCrew`, tank player frame (Task 5); `nextBowSequence` from `client/bow-control.ts`.
- Produces: `wheelTurns(from, to): number`, `reloadProgress(weapon, now): number`; `MinigamePlayerProps`, `MINIGAME_PLAYERS` in `client/minigames.tsx`; `TankPlayer`.

- [ ] **Step 1: Write the failing tests**

Create `client/tank-control.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { reloadProgress, wheelTurns } from './tank-control.ts'

test('wheel turns follow the pointer the short way across the ±π seam', () => {
  assert.equal(wheelTurns(0, Math.PI / 2), 0.25)
  assert.ok(Math.abs(wheelTurns(3, -3) - (2 * Math.PI - 6) / (2 * Math.PI)) < 1e-12)
  assert.ok(Math.abs(wheelTurns(-3, 3) + (2 * Math.PI - 6) / (2 * Math.PI)) < 1e-12)
})

test('reload progress fills from 0 to 1 and stays full when ready', () => {
  const weapon = { clip: 0, size: 1, reloadUntil: 5_000, reloadMs: 3_000 }
  assert.equal(reloadProgress(weapon, 2_000), 0)
  assert.equal(reloadProgress(weapon, 3_500), 0.5)
  assert.equal(reloadProgress(weapon, 6_000), 1)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test client/tank-control.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `client/tank-control.ts`**

```ts
import type { TankFrameWeapon } from '../shared/protocol.ts'

/** Turns between two pointer angles in radians, taking the short way across the ±π seam. */
export function wheelTurns(from: number, to: number): number {
  let delta = to - from
  if (delta > Math.PI) delta -= 2 * Math.PI
  else if (delta < -Math.PI) delta += 2 * Math.PI
  return delta / (2 * Math.PI)
}

/** Elapsed fraction of a reload; 1 once the weapon is ready. */
export function reloadProgress(weapon: TankFrameWeapon, now: number): number {
  if (now >= weapon.reloadUntil) return 1
  return Math.max(0, 1 - (weapon.reloadUntil - now) / weapon.reloadMs)
}
```

Run: `node --test client/tank-control.test.ts` — Expected: PASS.

- [ ] **Step 4: Create `client/minigames.tsx` and share the player props**

```tsx
import type { ComponentType } from 'preact'
import type { ClientMsg, MinigameFrame, MinigameId, MinigameInputAck, State } from '../shared/protocol.ts'
import { BowPlayer } from './BowPlayer.tsx'
import { TankPlayer } from './TankPlayer.tsx'

export type MinigamePlayerProps = {
  state: State
  playerId: string | null
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: MinigameInputAck | null
}

export const MINIGAME_PLAYERS: Record<MinigameId, ComponentType<MinigamePlayerProps>> = {
  bow: BowPlayer,
  tank: TankPlayer,
}
```

In `client/BowPlayer.tsx` replace the inline props type with `import type { MinigamePlayerProps } from './minigames.tsx'` and `export function BowPlayer({ state, frame, now, send, ack }: MinigamePlayerProps) {`. Drop the now-unused type imports.

In `client/Player.tsx` replace the `BowPlayer` import with `import { MINIGAME_PLAYERS } from './minigames.tsx'` and line 191 with:

```tsx
  if (state?.minigame) {
    const Surface = MINIGAME_PLAYERS[state.minigame.id]
    return <Surface state={state} playerId={playerId} frame={minigameFrame} now={now} send={send} ack={minigameAck} />
  }
```

If `playerId` from `useSocket` is typed differently from `string | null`, change `MinigamePlayerProps.playerId` to match it.

- [ ] **Step 5: Create `client/TankPlayer.tsx`**

```tsx
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TankFrameWeapon, TankInput } from '../shared/protocol.ts'
import { nextBowSequence } from './bow-control.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { reloadProgress, wheelTurns } from './tank-control.ts'

type Part = 'hull' | 'turret'
const SPOKES = [0, 60, 120, 180, 240, 300]

function Wheel({ label, onTurn }: { label: string; onTurn: (turns: number) => void }) {
  const last = useRef<number | null>(null)
  const total = useRef(0)
  const [shown, setShown] = useState(0)
  const angleOf = (event: PointerEvent) => {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    return Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2))
  }
  return (
    <div
      class="tank-wheel"
      aria-label={label}
      onPointerDown={(event) => {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        last.current = angleOf(event)
      }}
      onPointerMove={(event) => {
        if (last.current === null) return
        const next = angleOf(event)
        const turns = wheelTurns(last.current, next)
        last.current = next
        const before = total.current
        total.current += turns
        // A light tick every eighth of a turn.
        if (Math.floor(before * 8) !== Math.floor(total.current * 8)) navigator.vibrate?.(5)
        setShown(total.current)
        onTurn(turns)
      }}
      onPointerUp={() => { last.current = null }}
      onPointerCancel={() => { last.current = null }}
    >
      <svg viewBox="-100 -100 200 200">
        <g transform={`rotate(${shown * 360})`}>
          <circle r="80" class="tank-wheel__rim" />
          {SPOKES.map((deg) => (
            <line key={deg} x2={80 * Math.cos(deg * Math.PI / 180)} y2={80 * Math.sin(deg * Math.PI / 180)} class="tank-wheel__spoke" />
          ))}
          <circle r="14" class="tank-wheel__hub" />
          <circle cx="80" r="15" class="tank-wheel__knob" />
        </g>
      </svg>
    </div>
  )
}

function HoldButton({ class: className, onHold, children }: {
  class: string
  onHold: (down: boolean) => void
  children: ComponentChildren
}) {
  return (
    <button
      class={className}
      onPointerDown={(event) => {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        onHold(true)
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  )
}

function WeaponButton({ name, weapon, now, onHold }: {
  name: string
  weapon: TankFrameWeapon | undefined
  now: number
  onHold: (down: boolean) => void
}) {
  const progress = weapon ? reloadProgress(weapon, now) : 1
  const empty = !weapon || weapon.clip === 0
  return (
    <HoldButton class={empty ? 'tank-btn is-empty' : 'tank-btn'} onHold={onHold}>
      {progress < 1 && <span class="tank-btn__reload" style={{ width: `${progress * 100}%` }} />}
      <span class="tank-btn__text">{name}</span>
      <span class="tank-btn__text">{weapon ? `${weapon.clip}/${weapon.size}` : '–'}</span>
    </HoldButton>
  )
}

export function TankPlayer({ state, playerId, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const mine = frame?.matchId === session.matchId && frame.role === 'player' && frame.id === 'tank' ? frame : null
  const crew = session.crews?.find((c) => c.driver === playerId || c.gunner === playerId)
  const driver = !!crew && crew.driver === playerId
  const gunner = !!crew && crew.gunner === playerId
  const solo = driver && gunner
  const partner = crew && state.players.find((p) => p.id === (driver ? crew.gunner : crew.driver))?.name

  const sendRef = useRef(send)
  sendRef.current = send
  const input = (value: TankInput) =>
    sendRef.current({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: value })

  // Wheel turns accumulate and go out about 30 times a second.
  const pending = useRef<Record<Part, number>>({ hull: 0, turret: 0 })
  useEffect(() => {
    const id = setInterval(() => {
      for (const part of ['hull', 'turret'] as const) {
        const turns = pending.current[part]
        if (!turns) continue
        pending.current[part] = 0
        input(solo ? { kind: 'wheel', turns, part } : { kind: 'wheel', turns })
      }
    }, 33)
    return () => clearInterval(id)
  }, [session.matchId, solo])

  const held = useRef({ forward: false, back: false })
  const drive = (key: 'forward' | 'back', down: boolean) => {
    held.current[key] = down
    input({ kind: 'drive', dir: held.current.forward ? 1 : held.current.back ? -1 : 0 })
  }
  const trigger = (weapon: 'gun' | 'cannon', down: boolean) => input({ kind: 'trigger', weapon, down, at: now() })

  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const respawn = mine?.tank.respawnAt ? Math.max(0, Math.ceil((mine.tank.respawnAt - now()) / 1000)) : null
  const role = solo ? 'Solo crew' : driver ? 'Driver' : gunner ? 'Gunner' : 'Spectating'
  const status = session.phase === 'countdown' ? `Starts in ${countdown}`
    : session.phase === 'results' ? 'Match complete'
    : session.phase === 'ready' ? 'Waiting for host'
    : respawn !== null ? `Respawning in ${respawn}`
    : role

  return (
    <main class="tank-phone">
      <header class="bow-phone__instructions">
        <strong>{status}</strong>
        <span>{crew ? `${role}${partner && !solo ? ` with ${partner}` : ''} · ${mine?.tank.hp ?? 100} HP · ${mine?.tank.score ?? 0} pts` : 'Spectating until the next match'}</span>
      </header>
      <div class={mine && session.phase === 'playing' ? 'tank-phone__roles is-active' : 'tank-phone__roles'}>
        {driver && (
          <section class="tank-role">
            <Wheel label="Hull wheel" onTurn={(turns) => { pending.current.hull += turns }} />
            <div class="tank-buttons">
              <HoldButton class="tank-btn" onHold={(down) => drive('back', down)}><span class="tank-btn__text">Back</span></HoldButton>
              <HoldButton class="tank-btn" onHold={(down) => drive('forward', down)}><span class="tank-btn__text">Forward</span></HoldButton>
            </div>
          </section>
        )}
        {gunner && (
          <section class="tank-role">
            <Wheel label="Turret wheel" onTurn={(turns) => { pending.current.turret += turns }} />
            <div class="tank-buttons">
              <WeaponButton name="Gun" weapon={mine?.tank.gun} now={now()} onHold={(down) => trigger('gun', down)} />
              <WeaponButton name="Cannon" weapon={mine?.tank.cannon} now={now()} onHold={(down) => trigger('cannon', down)} />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Styles**

Append after the bow block in `client/style.css`:

```css
/* Tank is geometric placeholder UI while mechanics are tested. */
.tank-phone { height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--stage); color: var(--chalk); touch-action: none; user-select: none; -webkit-user-select: none; }
.tank-phone__roles { display: grid; grid-auto-rows: minmax(0, 1fr); min-height: 0; opacity: .5; }
.tank-phone__roles.is-active { opacity: 1; }
.tank-role { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: var(--s3); padding: var(--s4); min-height: 0; }
.tank-wheel { justify-self: center; height: 100%; max-width: 100%; aspect-ratio: 1; min-height: 0; touch-action: none; }
.tank-wheel svg { width: 100%; height: 100%; }
.tank-wheel__rim { fill: none; stroke: var(--tungsten); stroke-width: 14; }
.tank-wheel__spoke { stroke: var(--tungsten); stroke-width: 8; }
.tank-wheel__hub { fill: var(--tungsten); }
.tank-wheel__knob { fill: var(--chalk); }
.tank-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
.tank-btn { position: relative; overflow: hidden; min-height: 6rem; display: grid; place-content: center; gap: var(--s2); border: 0; border-radius: 1rem; background: var(--tungsten); color: var(--stage); font: 600 var(--t-lg)/1 var(--mono); touch-action: none; }
.tank-btn:active { filter: brightness(1.2); }
.tank-btn.is-empty { background: #77736d; color: #c8c3ba; }
.tank-btn__reload { position: absolute; inset: 0 auto 0 0; background: #c8c3ba; opacity: .35; }
.tank-btn__text { position: relative; }
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean typecheck, tests as before plus the two new client tests, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client
git commit -m "feat: tank phone wheel, drive and weapon controls"
```

---

### Task 7: Tank board and host controls

**Files:**
- Modify: `client/tank-control.ts` (add `coverPath`), `client/tank-control.test.ts`
- Create: `client/TankBoard.tsx`
- Modify: `client/minigames.tsx` (board map), `client/BowBoard.tsx:19` (shared props), `client/Board.tsx:11,303`, `client/Host.tsx:12-25,313-317`, `client/style.css`

**Interfaces:**
- Consumes: tank board frame (Task 5); `colorForPlayer` from `client/ui.ts`.
- Produces: `coverPath(cells: Uint8Array): string`; `MinigameBoardProps`, `MINIGAME_BOARDS`; `TankBoard`.

- [ ] **Step 1: Write the failing test**

Append to `client/tank-control.test.ts` (add `coverPath` to the import):

```ts
test('cover becomes one path with a rectangle per run of solid cells', () => {
  const cells = new Uint8Array(160 * 90)
  cells[2] = cells[3] = cells[4] = 1
  cells[160] = 1
  assert.equal(coverPath(cells), 'M20 0h30v10h-30zM0 10h10v10h-10z')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test client/tank-control.test.ts`
Expected: FAIL, `coverPath` is not exported.

- [ ] **Step 3: Implement `coverPath`**

Append to `client/tank-control.ts`:

```ts
const COLS = 160
const CELL = 10

/** Solid cover as one SVG path, one rectangle per run of solid cells in a row. */
export function coverPath(cells: Uint8Array): string {
  let d = ''
  for (let row = 0; row * COLS < cells.length; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!cells[row * COLS + col]) continue
      const start = col
      while (col + 1 < COLS && cells[row * COLS + col + 1]) col++
      const width = (col - start + 1) * CELL
      d += `M${start * CELL} ${row * CELL}h${width}v${CELL}h-${width}z`
    }
  }
  return d
}
```

Run: `node --test client/tank-control.test.ts` — Expected: PASS.

- [ ] **Step 4: Board props and routing**

Add to `client/minigames.tsx`:

```tsx
import { BowBoard } from './BowBoard.tsx'
import { TankBoard } from './TankBoard.tsx'

export type MinigameBoardProps = { state: State; frame: MinigameFrame | null; now: () => number }

export const MINIGAME_BOARDS: Record<MinigameId, ComponentType<MinigameBoardProps>> = {
  bow: BowBoard,
  tank: TankBoard,
}
```

`client/BowBoard.tsx:19`: `export function BowBoard({ state, frame, now }: MinigameBoardProps) {` with `import type { MinigameBoardProps } from './minigames.tsx'`.

`client/Board.tsx`: replace the `BowBoard` import with `import { MINIGAME_BOARDS } from './minigames.tsx'` and line 303 with:

```tsx
  if (state.minigame) {
    const Surface = MINIGAME_BOARDS[state.minigame.id]
    return <Surface state={state} frame={minigameFrame} now={now} />
  }
```

- [ ] **Step 5: Create `client/TankBoard.tsx`**

```tsx
import { useRef } from 'preact/hooks'
import type { MinigameFrame } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { coverPath } from './tank-control.ts'
import { colorForPlayer } from './ui.ts'

type TankBoardFrame = Extract<MinigameFrame, { role: 'board'; id: 'tank' }>

const BLAST_MS = 250
const AIM_DASHES = [0, 1, 2, 3, 4, 5, 6, 7]
const degrees = (radians: number) => radians * 180 / Math.PI

export function TankBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const board = frame?.role === 'board' && frame.id === 'tank' && frame.matchId === session.matchId ? frame : null
  const cells = useRef<Uint8Array | null>(null)
  const path = useRef('')
  const blasts = useRef<{ x: number; y: number; radius: number; at: number }[]>([])
  const seen = useRef<TankBoardFrame | null>(null)

  // ponytail: frames coalesced by a render lose their cleared cells until the next full grid (≤1 s); apply frames in the socket handler if walls visibly lag.
  if (board && seen.current !== board) {
    seen.current = board
    if (board.cover) cells.current = Uint8Array.from(board.cover, (digit) => digit === '1' ? 1 : 0)
    if (cells.current && (board.cover || board.coverChanged.length > 0)) {
      for (const index of board.coverChanged) cells.current[index] = 0
      path.current = coverPath(cells.current)
    }
    for (const blast of board.blasts) blasts.current.push({ ...blast.position, radius: blast.radius, at: now() })
  }
  blasts.current = blasts.current.filter((blast) => now() - blast.at < BLAST_MS)

  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'
  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0

  if (session.phase === 'results') return (
    <main class="bow-results">
      <p class="eyebrow">Tank results</p>
      <ol class="bow-results__list">
        {session.results?.map((result, index) => (
          <li key={result.playerId}>
            <span>{index + 1}. {nameOf(result.playerId)}</span>
            <strong>{result.points}</strong>
          </li>
        ))}
      </ol>
    </main>
  )

  return (
    <main class="bow-board">
      <header class="bow-board__header">
        <strong>Tank battle</strong>
        <span>{session.phase === 'ready' ? 'Ready' : session.phase === 'countdown' ? `Starts in ${countdown}` : `${remaining}s`}</span>
      </header>
      <svg class="bow-field" viewBox="0 0 1600 900" aria-label="Shared tank field">
        <rect width="1600" height="900" class="bow-field__ground" />
        <path d={path.current} class="tank-field__cover" />
        {board?.tanks.map((tank) => {
          const { x, y } = tank.position
          const names = tank.crew.driver === tank.crew.gunner
            ? nameOf(tank.crew.driver)
            : `${nameOf(tank.crew.driver)} & ${nameOf(tank.crew.gunner)}`
          return (
            <g key={tank.id} style={{ color: colorForPlayer(state, tank.crew.driver) }} opacity={tank.dead ? 0.25 : tank.invulnerable ? 0.6 : 1}>
              <g transform={`translate(${x} ${y}) rotate(${degrees(tank.hull)})`}>
                <rect x="-25" y="-17" width="50" height="34" rx="4" class="tank-field__hull" />
                <g transform={`rotate(${degrees(tank.turret)})`}>
                  {!tank.dead && AIM_DASHES.map((i) => (
                    <line key={i} x1={34 + i * 50} x2={64 + i * 50} class="tank-field__aim" opacity={0.7 * (1 - i / AIM_DASHES.length)} />
                  ))}
                  <line x2="30" class="tank-field__barrel" />
                  <circle r="10" class="tank-field__turret" />
                </g>
              </g>
              <rect x={x - 25} y={y - 34} width="50" height="5" class="tank-field__hp-back" />
              <rect x={x - 25} y={y - 34} width={50 * tank.hp / 100} height="5" class="tank-field__hp" />
              <text x={x} y={y + 44} class="bow-field__name">{names} · {tank.score}</text>
            </g>
          )
        })}
        {board?.projectiles.map((shot) => (
          <circle key={shot.id} cx={shot.position.x} cy={shot.position.y} r={shot.weapon === 'cannon' ? 6 : 3} class="tank-field__shot" />
        ))}
        {blasts.current.map((blast, index) => (
          <circle key={index} cx={blast.x} cy={blast.y} r={blast.radius} class="tank-field__blast" opacity={1 - (now() - blast.at) / BLAST_MS} />
        ))}
      </svg>
    </main>
  )
}
```

- [ ] **Step 6: Host controls**

In `client/Host.tsx` line 23 replace `<span class="host__title">Bow</span>` with:

```tsx
      <span class="host__title">{session.id === 'tank' ? 'Tank battle' : 'Bow'}</span>
```

After the **Prepare Bow** button (line ~317) add:

```tsx
          <button class="btn" onClick={() => act({ a: 'prepareMinigame', id: 'tank', options: { durationSec: 60 } })}>
            Prepare Tank
          </button>
```

- [ ] **Step 7: Styles**

Append to the tank block in `client/style.css`:

```css
.tank-field__cover { fill: #6b645a; }
.tank-field__hull { fill: currentColor; stroke: #24211e; stroke-width: 3; }
.tank-field__turret { fill: #24211e; }
.tank-field__barrel { stroke: #24211e; stroke-width: 7; stroke-linecap: round; }
.tank-field__aim { stroke: currentColor; stroke-width: 4; }
.tank-field__hp-back { fill: #24211e; }
.tank-field__hp { fill: #6fbf73; }
.tank-field__shot { fill: #b6b0a6; }
.tank-field__blast { fill: #d5ad45; }
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean; tests pass except the known clip test; build succeeds.

Manual: restart the server, open `/board`, join two phones, **Prepare Tank** → **Start match**, and check the wheel, buttons, aim lines, blasts and carved cover.

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat: tank board and host prepare control"
```

---

### Task 8: Tank self-play and docs

**Files:**
- Modify: `tools/conn.ts` (board role, last frame)
- Create: `tools/sim-tank.ts`
- Modify: `package.json` (script), `README.md` (Play section, tools block), `ARCHTECTURE.md` (minigame runtime row near line 46)

**Interfaces:**
- Consumes: `TankCrew`, `TankInput`, tank board frame; `connect`, `reachable`.
- Produces: `Conn.frame(): MinigameFrame | null`; `npm run sim-tank`.

- [ ] **Step 1: Let tool connections watch frames**

In `tools/conn.ts`:
- import `MinigameFrame` beside `ClientMsg, ServerMsg, State`;
- add `/** The latest minigame frame, for board connections. */ frame: () => MinigameFrame | null` to `Conn`;
- widen `role` to `'host' | 'player' | 'board'`;
- add `let frame: MinigameFrame | null = null`, a branch `else if (msg.t === 'minigameFrame') frame = msg.frame` in `onmessage`, and `frame: () => frame,` in the returned object.

- [ ] **Step 2: Create `tools/sim-tank.ts`**

```ts
/**
 * Synthetic self-play for the tank minigame. Bots join, get paired into crews
 * by the server, and fight: drivers steer toward the nearest enemy, gunners
 * crank the turret onto it and fire when lined up. Hull turns swing the gun,
 * so gunners keep correcting, which is the coordination the game is about.
 *
 * Bots read the shared field through a board connection, like the TV does.
 *
 *   npm run sim-tank                        endless 60-second matches
 *   npm run sim-tank -- 3 30                three 30-second matches
 *   npm run sim-tank -- 3 30 http://box:8080
 *
 * Ctrl-C cancels the match and removes the bots.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import type { TankCrew, TankInput } from '../shared/protocol.ts'

const [argMatches, argSeconds, argUrl] = process.argv.slice(2)
const MATCHES = Number(argMatches ?? Infinity)
const SECONDS = Number(argSeconds ?? 60)
const URL = argUrl ?? (await reachable())
const NAMES = ['Ivy', 'Jax', 'Kai', 'Lux', 'Mo', 'Rex', 'Zed']
const TICK_MS = 50

type Bot = { name: string; conn: Conn; seq: number }

const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const log = (s = '') => console.log(s)

async function crewLoop(crew: TankCrew, bots: Map<string, Bot>, board: Conn, matchId: string, endsAt: number) {
  const driver = bots.get(crew.driver)
  const gunner = bots.get(crew.gunner)
  if (!driver || !gunner) return
  const solo = driver === gunner
  const send = (bot: Bot, input: TankInput) => bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input })
  let drive: -1 | 0 | 1 = 0
  let gunDown = false
  let lastCannon = 0
  let last = { x: 0, y: 0 }
  let stuckTicks = 0
  let escapeTicks = 0

  while (board.now() < endsAt) {
    await sleep(TICK_MS)
    const frame = board.frame()
    if (frame?.role !== 'board' || frame.id !== 'tank' || frame.matchId !== matchId) continue
    const me = frame.tanks.find((tank) => tank.id === crew.id)
    const enemies = frame.tanks.filter((tank) => tank.id !== crew.id && !tank.dead)
    if (!me || me.dead || enemies.length === 0) continue
    const distanceTo = (p: { x: number; y: number }) => Math.hypot(p.x - me.position.x, p.y - me.position.y)
    const target = enemies.reduce((a, b) => distanceTo(a.position) < distanceTo(b.position) ? a : b)
    const distance = distanceTo(target.position)
    const bearing = Math.atan2(target.position.y - me.position.y, target.position.x - me.position.x)

    // Driver: steer at the target, hold a middle distance, and back out when wedged on cover.
    const moved = Math.hypot(me.position.x - last.x, me.position.y - last.y)
    last = { ...me.position }
    stuckTicks = drive !== 0 && moved < 0.5 ? stuckTicks + 1 : 0
    if (stuckTicks > 10) escapeTicks = 15
    const hullError = wrap(bearing - me.hull)
    let nextDrive: -1 | 0 | 1 = Math.abs(hullError) > 1 ? 0 : distance > 380 ? 1 : distance < 220 ? -1 : 0
    let hullTurns = clamp(hullError / (Math.PI / 2), -0.15, 0.15)
    if (escapeTicks > 0) {
      escapeTicks--
      nextDrive = -1
      hullTurns = 0.12
    }
    send(driver, solo ? { kind: 'wheel', turns: hullTurns, part: 'hull' } : { kind: 'wheel', turns: hullTurns })
    if (nextDrive !== drive) {
      drive = nextDrive
      send(driver, { kind: 'drive', dir: drive })
    }

    // Gunner: correct for the hull, with a little hand wobble.
    const aimError = wrap(bearing - me.hull - me.turret) + (Math.random() - 0.5) * 0.1
    const turretTurns = clamp(aimError / (Math.PI / 2), -0.2, 0.2)
    send(gunner, solo ? { kind: 'wheel', turns: turretTurns, part: 'turret' } : { kind: 'wheel', turns: turretTurns })
    const aligned = Math.abs(aimError) < 0.08
    if (aligned !== gunDown) {
      gunDown = aligned
      send(gunner, { kind: 'trigger', weapon: 'gun', down: gunDown, at: board.now() })
    }
    if (aligned && board.now() - lastCannon > 3_100) {
      lastCannon = board.now()
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: true, at: board.now() })
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: false, at: board.now() })
    }
  }
}

async function main() {
  log(`\n  Party Buzzer — tank self-play against ${URL}`)
  log(`  ${SECONDS}-second matches${MATCHES === Infinity ? '' : `, ${MATCHES} of them`}  ·  Ctrl-C to stop\n`)

  const host = await connect(URL, 'host')
  const board = await connect(URL, 'board')
  const bots = new Map<string, Bot>()
  for (const name of NAMES) {
    // Sequence numbers start from the clock so a rerun never reuses remembered ones.
    const bot: Bot = { name, conn: await connect(URL, 'player', name), seq: Date.now() }
    bots.set(bot.conn.playerId, bot)
    await sleep(40)
  }
  log(`  ${bots.size} bots in the room: ${NAMES.join(', ')}`)

  const cleanup = () => {
    host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    host.send({ t: 'host', action: { a: 'closeMinigame' } })
    for (const bot of bots.values()) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
    board.close()
    log('\n  match closed, bots removed.\n')
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', cleanup)

  if (host.state()?.round.phase !== 'IDLE') {
    host.send({ t: 'host', action: { a: 'next' } })
    await host.waitFor((s) => s.round.phase === 'IDLE')
  }
  const nameOf = (id: string) => host.state()?.players.find((p) => p.id === id)?.name ?? '?'

  for (let m = 1; m <= MATCHES; m++) {
    const previous = host.state()?.minigame?.matchId
    if (host.state()?.minigame?.phase === 'playing' || host.state()?.minigame?.phase === 'countdown') {
      host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    }
    host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'tank', options: { durationSec: SECONDS } } })
    await host.waitFor((s) => s.minigame?.phase === 'ready' && s.minigame.matchId !== previous)
    host.send({ t: 'host', action: { a: 'startMinigame' } })
    const session = (await host.waitFor((s) => s.minigame?.phase === 'countdown')).minigame!
    const crews = session.crews ?? []

    log('')
    log(`  ── Match ${m}  ·  ${crews.length} crews`)
    for (const crew of crews) {
      log(`     ${crew.driver === crew.gunner ? `${nameOf(crew.driver)} (solo)` : `${nameOf(crew.driver)} drives, ${nameOf(crew.gunner)} guns`}`)
    }

    await sleep(Math.max(0, session.startsAt! - host.now()))
    await Promise.all(crews.map((crew) => crewLoop(crew, bots, board, session.matchId, session.endsAt!)))

    const done = await host.waitFor(
      (s) => s.minigame?.phase === 'results' || s.minigame?.matchId !== session.matchId,
      SECONDS * 1000 + 10_000,
    )
    if (done.minigame?.phase !== 'results') {
      log('     match was cancelled')
      break
    }
    for (const result of done.minigame.results ?? []) {
      log(`     ${nameOf(result.playerId).padEnd(6)} ${String(result.points).padStart(4)} pts  ${result.shots} shots`)
    }
    await sleep(4000)
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
```

- [ ] **Step 3: Scripts and docs**

`package.json` scripts, after `sim-bow`:

```json
    "sim-tank": "node tools/sim-tank.ts",
```

`README.md`: in the tools block add `npm run sim-tank -- 3 30` after `sim-bow`. After the Bow minigame section add:

```markdown
### Tank minigame

Press **Prepare Tank** and **Start match** on `/host`. Start pairs connected
players into random two-person crews; an odd player out drives and guns a tank
alone. The driver spins a wheel to turn the hull and holds Forward or Back. The
gunner spins a wheel to turn the turret, holds Gun, and taps Cannon. The turret
turns with the hull, so crews have to coordinate their aim. Shots carve the
cover, destroyed tanks respawn after three seconds, and each crew's damage and
kill points are added to both members' scores when the match ends.
```

`ARCHTECTURE.md` minigame runtime row: change the files cell to `` `server/minigames/runtime.ts`, `server/minigames/registry.ts`, `server/minigames/bow/`, `server/minigames/tank/` `` and the description to "Match lifecycle, fixed-step simulation, queued inputs, role frames; bow and tank rules behind registry definitions".

- [ ] **Step 4: Verify end to end**

Run: `npm run typecheck && npm test`
Expected: clean; only the known clip test fails.

Then with a server running on the new build (`npm run build`, `npm run kill`, `npm start`): `npm run sim-tank -- 1 20`
Expected: crew lines, then a results list where every bot has a score line and some bots have points above 0. Ctrl-C leaves the room without bots.

- [ ] **Step 5: Commit**

```bash
git add tools package.json README.md ARCHTECTURE.md
git commit -m "feat: tank self-play and docs"
```

