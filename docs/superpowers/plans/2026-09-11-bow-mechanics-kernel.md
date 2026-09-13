# Bow Mechanics Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, server-side bow simulation that can be tested
without sockets, lifecycle state, rendering, or polished visual assets.

**Architecture:** A focused module under `server/minigames/bow/` owns logical
coordinates, seeded target placement, shot creation, fixed-step flight,
collisions, scoring, expiry, and result calculation. The module mutates its own
transient `BowWorld` for predictable runtime cost but has no access to Party
Buzzer `State`, clocks, sockets, or browser code. Later plans will wrap this
kernel in the minigame runtime and render its projections with plain shapes.

**Tech Stack:** Node 26 native TypeScript, `node:test`, `node:assert/strict`; no
new runtime or development dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-minigames-design.md`

## Global Constraints

- Server TypeScript uses Node type stripping and `.ts` relative imports.
- Do not use enums, namespaces, or constructor parameter properties.
- Use a fixed `1000 / 60` ms simulation step; timer accumulation belongs to a
  later runtime plan.
- Keep the kernel deterministic for the same seed, players, and ordered inputs.
- Keep all coordinates in a `1600 × 900` logical field independent of pixels.
- Use simple swept segments, circles, and arrow capsules; do not add a physics
  engine or another dependency.
- The kernel cannot read `Date.now()`, schedule timers, mutate `State`, commit
  scores, send messages, or import client code.
- Use plain geometric placeholders when this kernel is integrated. The rejected
  studies under `docs/superpowers/visuals/bow/` are not implementation sources.

## File structure

- `server/minigames/bow/types.ts`: constants and the complete data contract for
  the pure simulation.
- `server/minigames/bow/geometry.ts`: small allocation-free vector and swept
  collision helpers.
- `server/minigames/bow/world.ts`: seeded world creation, aim/release commands,
  one fixed step, collisions, cleanup, trajectory sampling, and results.
- `server/minigames/bow/geometry.test.ts`: exact tests for the geometric
  primitives that prevent tunneling and define contact positions.
- `server/minigames/bow/world.test.ts`: outcome tests for the playable rules and
  determinism boundaries.

---

### Task 1: Geometry and simulation contract

**Files:**
- Create: `server/minigames/bow/types.ts`
- Create: `server/minigames/bow/geometry.ts`
- Create: `server/minigames/bow/geometry.test.ts`

**Interfaces:**
- Consumes: no new project interfaces.
- Produces: `Vec2`, `BowTarget`, `BowArrow`, `BowPlayer`, `BowWorld`,
  `BOW_STEP_MS`, `add`, `sub`, `scale`, `dot`, `length`, `normalize`,
  `closestPointOnSegment`, `segmentCircleHit`, and `segmentDistance`.

- [ ] **Step 1: Write failing geometry tests**

Create `server/minigames/bow/geometry.test.ts` with cases that define the
contact math used by every later collision:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  closestPointOnSegment, segmentCircleHit, segmentDistance,
} from './geometry.ts'

test('segmentCircleHit returns the first contact along a swept tip', () => {
  const hit = segmentCircleHit({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, 3)
  assert.ok(hit)
  assert.ok(Math.abs(hit.t - 0.35) < 1e-9)
  assert.deepEqual(hit.point, { x: 7, y: 0 })
  assert.deepEqual(hit.normal, { x: -1, y: 0 })
})

test('segmentCircleHit reports no contact when the swept tip misses', () => {
  assert.equal(
    segmentCircleHit({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 4 }, 3),
    null,
  )
})

test('closestPointOnSegment clamps to an endpoint', () => {
  assert.deepEqual(
    closestPointOnSegment({ x: -2, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    { point: { x: 0, y: 0 }, t: 0 },
  )
})

test('segmentDistance detects crossing arrow shafts', () => {
  const d = segmentDistance(
    { x: 0, y: 0 }, { x: 10, y: 10 },
    { x: 0, y: 10 }, { x: 10, y: 0 },
  )
  assert.ok(d < 1e-9)
})
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

```sh
node --test server/minigames/bow/geometry.test.ts
```

Expected: FAIL because `geometry.ts` does not exist.

- [ ] **Step 3: Define the simulation data contract**

Create `server/minigames/bow/types.ts`. Use string unions, plain objects, and
readonly configuration values:

```ts
export const BOW_STEP_MS = 1000 / 60
export const BOW_FIELD = { width: 1600, height: 900 } as const

export type Vec2 = { x: number; y: number }
export type BowAim = { angle: number; tension: number }
export type BowTarget = { id: string; center: Vec2; radius: number }

export type BowArrow = {
  id: string
  playerId: string
  position: Vec2
  previous: Vec2
  velocity: Vec2
  angle: number
  bornAtMs: number
  lodgedAtMs?: number
  state: 'flying' | 'lodged-target' | 'lodged-boundary'
  targetId?: string
  tailKick: number
}

export type BowPlayer = {
  id: string
  origin: Vec2
  aim: BowAim
  reloadUntilMs: number
  score: number
  shots: number
}

export type BowConfig = {
  reloadMs: number
  gravity: number
  minSpeed: number
  maxSpeed: number
  flyingLifetimeMs: number
  lodgedLifetimeMs: number
  entityCap: number
}

export type BowWorld = {
  seed: number
  tick: number
  nowMs: number
  nextArrow: number
  config: BowConfig
  players: Record<string, BowPlayer>
  targets: BowTarget[]
  arrows: BowArrow[]
}
```

- [ ] **Step 4: Implement the geometry helpers**

Create `server/minigames/bow/geometry.ts`. `segmentCircleHit` must solve the
quadratic for the first `t` in `[0, 1]`, including a segment that starts inside
the circle. `segmentDistance` returns the minimum of the four endpoint-to-
segment distances after checking for segment intersection.

```ts
import type { Vec2 } from './types.ts'

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (v: Vec2, n: number): Vec2 => ({ x: v.x * n, y: v.y * n })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const length = (v: Vec2): number => Math.hypot(v.x, v.y)
export const normalize = (v: Vec2): Vec2 => {
  const n = length(v)
  return n === 0 ? { x: 0, y: -1 } : scale(v, 1 / n)
}

export type SegmentPoint = { point: Vec2; t: number }
export type CircleHit = SegmentPoint & { normal: Vec2 }
```

- [ ] **Step 5: Run the focused tests**

Run `node --test server/minigames/bow/geometry.test.ts`.

Expected: all geometry tests PASS.

- [ ] **Step 6: Commit the geometry boundary**

```sh
git add server/minigames/bow/types.ts server/minigames/bow/geometry.ts server/minigames/bow/geometry.test.ts
git commit -m "feat: add deterministic bow geometry"
```

---

### Task 2: Seeded world, aim, release, reload, and flight

**Files:**
- Create: `server/minigames/bow/world.ts`
- Create: `server/minigames/bow/world.test.ts`
- Modify: `server/minigames/bow/types.ts`

**Interfaces:**
- Consumes: the types and vector helpers from Task 1.
- Produces:
  `createBowWorld(input: CreateBowWorld): BowWorld`,
  `setBowAim(world, playerId, aim): BowCommandResult`,
  `releaseBow(world, playerId): BowReleaseResult`, and
  `stepBow(world): void`.

- [ ] **Step 1: Write failing world and command tests**

Start `server/minigames/bow/world.test.ts` with explicit targets so command and
flight tests do not depend on layout generation:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOW_STEP_MS } from './types.ts'
import { createBowWorld, releaseBow, setBowAim, stepBow } from './world.ts'

const world = () => createBowWorld({
  seed: 7,
  playerIds: ['ada'],
  targets: [{ id: 'far', center: { x: 1400, y: 100 }, radius: 40 }],
})

test('sanitizes finite normalized aim and refuses invalid input', () => {
  const w = world()
  assert.deepEqual(setBowAim(w, 'ada', { angle: 2, tension: -1 }), { status: 'applied' })
  assert.deepEqual(w.players.ada.aim, { angle: 1, tension: 0 })
  assert.deepEqual(
    setBowAim(w, 'ada', { angle: Number.NaN, tension: 1 }),
    { status: 'refused', reason: 'invalid-aim' },
  )
})

test('release spawns once and reload prevents an immediate second shot', () => {
  const w = world()
  setBowAim(w, 'ada', { angle: 0, tension: 1 })
  const first = releaseBow(w, 'ada')
  assert.equal(first.status, 'accepted')
  assert.equal(w.arrows.length, 1)
  assert.deepEqual(releaseBow(w, 'ada'), { status: 'refused', reason: 'reloading' })
  assert.equal(w.arrows.length, 1)
})

test('one step integrates velocity and gravity at the fixed rate', () => {
  const w = world()
  setBowAim(w, 'ada', { angle: 0, tension: 1 })
  releaseBow(w, 'ada')
  const before = structuredClone(w.arrows[0])
  stepBow(w)
  assert.equal(w.tick, 1)
  assert.ok(Math.abs(w.nowMs - BOW_STEP_MS) < 1e-9)
  assert.ok(w.arrows[0].position.y < before.position.y)
  assert.ok(w.arrows[0].velocity.y > before.velocity.y)
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run `node --test server/minigames/bow/world.test.ts`.

Expected: FAIL because `world.ts` does not exist.

- [ ] **Step 3: Add command result and construction types**

Append to `types.ts`:

```ts
export type CreateBowWorld = {
  seed: number
  playerIds: string[]
  targets?: BowTarget[]
  config?: Partial<BowConfig>
}

export type BowCommandResult =
  | { status: 'applied' | 'unchanged' }
  | { status: 'refused'; reason: 'unknown-player' | 'invalid-aim' }

export type BowReleaseResult =
  | { status: 'accepted'; arrowId: string; reloadUntilMs: number }
  | { status: 'refused'; reason: 'unknown-player' | 'reloading' | 'capacity' }
```

- [ ] **Step 4: Implement deterministic world creation**

In `world.ts`, define one default config and a local Mulberry32 generator. Lay
players evenly along `y = 850`. If tests do not supply targets, generate five
targets in stable horizontal lanes above `y = 520`, rejecting overlaps and bow
origins with bounded attempts. Sort and de-duplicate `playerIds` before placing
them so join order does not change positions.

```ts
const DEFAULT_CONFIG: BowConfig = {
  reloadMs: 700,
  gravity: 980,
  minSpeed: 700,
  maxSpeed: 1500,
  flyingLifetimeMs: 6000,
  lodgedLifetimeMs: 12000,
  entityCap: 256,
}

const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = seed + 0x6d2b79f5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}
```

- [ ] **Step 5: Implement aim, release, and one fixed flight step**

Clamp normalized `angle` and `tension` to `[-1, 1]` and `[0, 1]`. Convert angle
to at most `65°` from up. Spawn an arrow just above its bow with speed
`minSpeed + (maxSpeed - minSpeed) * tension`. Give ids the stable form
`arrow-${nextArrow}`. `stepBow` copies `position` to `previous`, applies gravity,
integrates position, updates arrow angle from velocity, advances `tick` and
`nowMs`, and does not read wall time.

- [ ] **Step 6: Add reload and capacity outcome tests**

Add tests that step until `reloadUntilMs`, accept the next release on the first
legal tick, and refuse at `entityCap` without changing `arrows`, `shots`, or
`reloadUntilMs`.

- [ ] **Step 7: Run focused tests**

Run:

```sh
node --test server/minigames/bow/geometry.test.ts server/minigames/bow/world.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit playable flight**

```sh
git add server/minigames/bow/types.ts server/minigames/bow/world.ts server/minigames/bow/world.test.ts
git commit -m "feat: add bow shots and fixed-step flight"
```

---

### Task 3: Target scoring and field boundaries

**Files:**
- Modify: `server/minigames/bow/world.ts`
- Modify: `server/minigames/bow/world.test.ts`

**Interfaces:**
- Consumes: `stepBow`, swept-circle contact, `BowTarget`, and `BowArrow`.
- Produces: target and boundary lodging inside `stepBow`; no new public API.

- [ ] **Step 1: Write failing target outcome tests**

Use zero gravity and explicit arrow states to isolate collisions. Cover all
three score bands with expected values `30`, `20`, and `10`, and prove that an
already lodged arrow never scores twice:

```ts
test('a swept tip lodges at the target perimeter and scores by centerline miss', () => {
  const w = createBowWorld({
    seed: 1,
    playerIds: ['ada'],
    config: { gravity: 0 },
    targets: [{ id: 't', center: { x: 800, y: 300 }, radius: 100 }],
  })
  w.arrows.push({
    id: 'arrow-test',
    playerId: 'ada',
    position: { x: 800, y: 420 },
    previous: { x: 800, y: 440 },
    velocity: { x: 0, y: -1800 },
    angle: -Math.PI / 2,
    bornAtMs: 0,
    state: 'flying',
    tailKick: 0,
  })
  stepBow(w)
  assert.equal(w.arrows[0].state, 'lodged-target')
  assert.equal(w.arrows[0].targetId, 't')
  assert.ok(Math.abs(w.arrows[0].position.y - 400) < 1e-6)
  assert.equal(w.players.ada.score, 30)
  stepBow(w)
  assert.equal(w.players.ada.score, 30)
})
```

For scoring, use the perpendicular distance between the arrow's swept
centerline and target center. This lets a side-view arrow lodge at the target's
outer edge while the visible concentric bands still determine value. Thresholds
are `0.28R`, `0.62R`, and `1.0R`.

- [ ] **Step 2: Write failing boundary tests**

Cover left, right, and top contact. The tip must clamp to the first boundary,
velocity must become zero, and the arrow must enter `lodged-boundary`. An arrow
that falls below the bottom is removed rather than lodged so misses do not
obstruct player bows.

- [ ] **Step 3: Run the target and boundary tests and verify failure**

Run `node --test server/minigames/bow/world.test.ts`.

Expected: FAIL because flying arrows pass through targets and boundaries.

- [ ] **Step 4: Implement earliest-contact resolution**

For each flying arrow, collect target and boundary contacts as `{ t, kind }`,
select the smallest `t`, move the arrow tip to that contact, zero velocity, and
set its state. Apply score only in the transition from `flying` to
`lodged-target`. Preserve the arrow direction at contact so later shaft
collisions have stable geometry.

- [ ] **Step 5: Run focused tests**

Run `node --test server/minigames/bow/geometry.test.ts server/minigames/bow/world.test.ts`.

Expected: all tests PASS.

- [ ] **Step 6: Commit scoring and boundaries**

```sh
git add server/minigames/bow/world.ts server/minigames/bow/world.test.ts
git commit -m "feat: resolve bow targets and field boundaries"
```

---

### Task 4: Arrow collisions, expiry, and deterministic results

**Files:**
- Modify: `server/minigames/bow/types.ts`
- Modify: `server/minigames/bow/world.ts`
- Modify: `server/minigames/bow/world.test.ts`

**Interfaces:**
- Consumes: world stepping, arrow geometry, lifetimes, and per-player scores.
- Produces:
  `sampleBowTrajectory(world, playerId, count): Vec2[]` and
  `bowResults(world): BowResult[]`.

- [ ] **Step 1: Write failing lodged-arrow collision tests**

Create a lodged shaft crossing a flying arrow's swept path. Assert that the
flying arrow remains flying with a changed velocity, loses energy, and moves
out of overlap; the lodged arrow remains fixed and receives a bounded nonzero
`tailKick`. On subsequent steps `tailKick` decays toward zero and never changes
the authoritative shaft endpoints.

- [ ] **Step 2: Write failing flying-arrow collision tests**

Fire two arrows through one another within one tick. Assert that swept shaft
distance catches the collision, their normal velocity components exchange
with restitution `0.35`, their tangential components remain, and equal ids are
processed in stable lexical order. Add a parallel near-miss that leaves both
velocities unchanged.

- [ ] **Step 3: Write failing cleanup and result tests**

```ts
test('expiry is based on simulation time and results have stable tie order', () => {
  const w = createBowWorld({ seed: 3, playerIds: ['zoe', 'ada'], targets: [] })
  w.players.zoe.score = 20
  w.players.ada.score = 20
  w.players.zoe.shots = 3
  w.players.ada.shots = 2
  assert.deepEqual(bowResults(w), [
    { playerId: 'ada', points: 20, shots: 2 },
    { playerId: 'zoe', points: 20, shots: 3 },
  ])
})
```

Add a flying arrow older than `flyingLifetimeMs` and a lodged arrow older than
`lodgedLifetimeMs`; one step removes both. Confirm cleanup occurs before the
next release capacity check can accept a new arrow.

- [ ] **Step 4: Implement stable arrow collision pairs**

Build pairs from arrows sorted by id and resolve each unordered pair once.
Represent a shaft as the tip/center position and a tail offset by
`48 * { cos(angle), sin(angle) }`. Use radius `4`. A flying-versus-lodged hit
reflects the flying normal component with restitution `0.35`, retains `80%` of
its total speed, and sets the lodged arrow's `tailKick` from the bounded normal
impulse. A flying-versus-flying hit applies equal-mass impulses to both.

- [ ] **Step 5: Implement cleanup, trajectory samples, and results**

Add this result type to `types.ts`:

```ts
export type BowResult = { playerId: string; points: number; shots: number }
```

`sampleBowTrajectory` uses the player's current normalized aim and the same
speed/gravity constants as `releaseBow`, returns at most 24 samples, and never
mutates the world. `bowResults` returns every player sorted by points
descending, shots ascending, then player id ascending. It calculates only; it
does not commit Party Buzzer scores.

- [ ] **Step 6: Add a deterministic replay regression**

Create two worlds with the same seed and players. Apply the same ordered aim,
release, and fixed-step calls to both, then assert `deepEqual`. Create a third
world with a different seed and assert its generated targets differ while its
config and player placement stay equal.

- [ ] **Step 7: Run focused and project validation**

Run:

```sh
node --test server/minigames/bow/geometry.test.ts server/minigames/bow/world.test.ts
npm test
npm run typecheck
npm run build
```

Expected: every command exits zero. If a pre-existing unrelated change causes
a failure, record the exact command and failure instead of changing that work.

- [ ] **Step 8: Commit the completed kernel**

```sh
git add server/minigames/bow/types.ts server/minigames/bow/world.ts server/minigames/bow/world.test.ts
git commit -m "feat: complete deterministic bow mechanics"
```

## Follow-up plans

This kernel intentionally stops before three separately reviewable systems:

1. Minigame registry, durable lifecycle, runtime clock, host actions, setlist
   blocks, snapshot behavior, and score commit.
2. WebSocket input/frame envelopes, acknowledgments, retry identity, role
   projections, deadlines, and landing grace.
3. Plain player, board, and host placeholder surfaces plus manual multi-device
   validation.

Visual art and motion direction remain deferred until the placeholder build is
playable and the whole minigame can be designed as one coherent system.
