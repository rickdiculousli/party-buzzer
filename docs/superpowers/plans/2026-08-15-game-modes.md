# Game Modes, Items, and Quizbowl-lite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A framework for pluggable game modes plus a framework-level item system (boons/sabotage), proven by a quizbowl-lite module with spoken-question power windows and fragment reveal on the board.

**Architecture:** Mode modules declare an option schema and optional hooks (`onCorrect`/`onWrong`/`onAct`/`onArm`/`canBuzz`/`viewModuleState`/`grants`); all module and item state lives inside `State` so undo, snapshot, and broadcast work untouched. Items ride a generic `act` channel. A `npm run read` tool owns the question pack and drives power timing via macOS `say`. Clients resolve surfaces through a registry that falls back to the current screens.

**Tech Stack:** Node 26 native TypeScript, `ws`, Preact, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-15-game-modes-design.md`

## Global Constraints

- **Node 26.7.0, native TypeScript.** Relative imports carry `.ts` extensions. No `enum`, `namespace`, or constructor parameter properties. No server build step.
- **Runtime dependencies are exactly `ws` and `qrcode`.** Do not add any. Client is `preact` (devDep, bundled by Vite).
- **No CDN or remote assets anywhere.** Party WiFi has no internet route.
- **Tests use `node:test` and `node:assert/strict` only.** Run a single file with `node --test path/to/file.test.ts`; the full suite is `npm test` (it globs `'server/*.test.ts' 'client/*.test.ts'` — Task 12 adds `'tools/*.test.ts'`).
- **`npm start` serves `dist/`.** Client changes are invisible until `npm run build`.
- **`resolve.ts` stays pure and untouched** (spec requirement). Buzz resolution changes go in the hub's call sites, never in `resolve.ts`.
- Deliberate simplifications carry a `ponytail:` comment naming the ceiling and upgrade path.
- `docs/design.md` is the visual source of truth; new CSS uses existing tokens (`--t-*` sizes, `--s*` spacing, `--brass`/`--tungsten`/`--cyan` colors).

## Plan refinements beyond the spec (read first)

The spec's shape stands; four details changed when written against the code:

1. **`GameModule` gains two optional hooks the spec's Wire section already implied:** `onAct(state, act, data): boolean` (the "module's handler" the hub dispatches to — quizbowl's `powerEnds` arrives this way) and `onArm(state)` (clears per-question module state; called by the framework on the `arm` action only, NOT on a `wrong` rebound, which is what makes rebound buzzes correctly unpowered).
2. **Power eligibility is NOT keyed to `armedAt`.** `moduleState.powerEndsAt` is an absolute server timestamp; `arm` clears it via `onArm`, rebounds keep it. A rebound buzz lands after power ended and is unpowered automatically — real quizbowl behavior for free.
3. **Steal is effect-based, not an order mutation.** `round.order` is recomputed from `pending` on every publish, so a direct mutation would be clobbered. Steal's `apply` pushes a `{kind:'steal'}` effect; `Hub.publish` prepends the thief.
4. **Re-saving the current mode's options does not reset scores.** `setGame` with the same `id` updates options in place; a different `id` is the reset-the-game switch. Otherwise editing one option mid-night would wipe the standings.

File map (new files in **bold**):

- `shared/protocol.ts` — wire types (Task 1)
- **`shared/modes/types.ts`** — `GameModule`/`ItemDef`/`ItemGrant` (Task 2)
- **`server/modes/index.ts`**, **`server/modes/trivia.ts`**, **`server/modes/index.test.ts`** — registry (Task 2); **`server/modes/quizbowl.ts`**, **`server/modes/quizbowl.test.ts`** (Task 6)
- `server/state.ts` — `setGame`, hook application, effect lifecycle, migrations (Tasks 3, 4, 6); **`server/state.test.ts`**
- **`server/items.ts`**, **`server/items.test.ts`** — item defs, `useItem`, `executeGrants` (Task 5)
- `server/hub.ts` — act dispatch, buzz gating, publish, redaction (Task 7); **`server/hub.test.ts`**
- `client/Board.tsx`, `client/style.css` — question/answer display (Task 8)
- **`client/modes/index.ts`**, **`client/modes/Switch.tsx`**, `client/main.tsx` — surface registry (Task 9)
- **`client/GameSettings.tsx`**, `client/Host.tsx` — schema-driven settings + power chip (Task 10)
- `client/Player.tsx` — inventory row, frozen state (Task 11)
- **`tools/pack.ts`**, **`tools/pack.test.ts`** — question pack parser (Task 12)
- **`tools/read.ts`**, **`tools/sample-pack.txt`**, `package.json` — the `say` reader (Task 13)
- `tools/sim.ts`, `tools/probe.ts` — `--game` flag, `act:` steps (Task 14)
- **`server/e2e.ts`**, `server/integration.test.ts`, **`server/game-modes.integration.test.ts`** — shared fake client, quizbowl end-to-end (Task 15)
- `CLAUDE.md`, `README.md` — docs (Task 16)

Known-safe import cycle: `server/state.ts` ↔ `server/modes/index.ts` ↔ `server/modes/quizbowl.ts` ↔ `server/state.ts` (and `server/items.ts` ↔ `server/state.ts`). Every cross-use is inside a function body and all exports are hoisted `export function`/`export const` of function type, so ESM evaluation order never observes a dead binding. Do not add module-eval-time uses across these files.

---

### Task 1: Wire types

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/state.ts` (`newState` only)

**Interfaces:**
- Produces: `GameState`, `OptionSpec`, `GameInfo`, `ActiveEffect` types; `State.game`/`items`/`effects`/`games`; `Round.fragments`/`answer`; `HostAction` `setGame`; `ClientMsg` `act`. Every later task consumes these.

- [ ] **Step 1: Baseline**

Run: `npm test && npm run typecheck`
Expected: all green before touching anything.

- [ ] **Step 2: Add the types to `shared/protocol.ts`**

After the `Round` type's `award` field, add:

```ts
export type Round = {
  // ...existing fields unchanged...
  award?: { name: string; points: number }
  /** Question text revealed so far, in order. Stripped from player views. */
  fragments?: string[]
  /** Revealed after scoring, if a question pack supplied one. Stripped from player views. */
  answer?: string
}
```

(Apply by adding the two fields to the existing `Round`, not redeclaring it.)

After the `State` type's dependencies, add the new types and extend `State`:

```ts
/** The active game mode. `id` names a registered module; the rest is its data. */
export type GameState = {
  id: string
  /** Values for the module's declared option schema, defaults filled. */
  options: Record<string, unknown>
  /** Opaque to the framework; the module owns and interprets it. */
  moduleState: unknown
}

/** A mode option, declared as data so the host settings form needs no per-mode code. */
export type OptionSpec =
  | { kind: 'int'; key: string; label: string; default: number; min: number; max: number }
  | { kind: 'bool'; key: string; label: string; default: boolean }
  | { kind: 'choice'; key: string; label: string; default: string; choices: string[] }

/** One registered mode, for the host's settings form. Ships in the state payload. */
export type GameInfo = { id: string; name: string; options: OptionSpec[] }

/**
 * A live item effect. Stamped with the arm it belongs to when the question
 * opens; swept on the next arm, so nothing leaks across questions.
 */
export type ActiveEffect = {
  kind: 'frozen' | 'steal'
  playerId: PlayerId
  roundArmedAt?: number
}

export type State = {
  mode: Mode
  players: Player[]
  teams: Team[]
  scores: Record<ScoreKey, number>
  round: Round
  game: GameState
  /** Item ids per player; duplicates mean a count. */
  items: Record<PlayerId, string[]>
  effects: ActiveEffect[]
  /** Static module catalog. The hub refreshes it at startup; snapshots keep a stale copy harmlessly. */
  games: GameInfo[]
}
```

Extend the two message unions:

```ts
export type HostAction =
  // ...existing variants...
  | { a: 'assign'; playerId: PlayerId; teamId?: TeamId }
  | { a: 'setGame'; id: string; options: Record<string, unknown> }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }
  /** Module and item actions. Dispatched by the hub; unknown acts are dropped. */
  | { t: 'act'; act: string; data?: unknown }
```

- [ ] **Step 3: Extend `newState()` in `server/state.ts`**

```ts
export function newState(): State {
  return {
    mode: 'solo',
    players: [],
    teams: [],
    scores: {},
    // The default mode is trivia, which has no options and an empty module
    // state; written as a literal so newState never touches the registry.
    game: { id: 'trivia', options: {}, moduleState: {} },
    items: {},
    effects: [],
    games: [],
    round: {
      value: 100,
      phase: 'IDLE',
      armedAt: 0,
      order: [],
      total: 0,
      lockedOut: [],
    },
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS. (Existing code never touches the new fields.)

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.ts server/state.ts
git commit -m "feat: wire types for game modes, items, and effects"
```

---

### Task 2: Module interface, trivia, and the registry

**Files:**
- Create: `shared/modes/types.ts`
- Create: `server/modes/trivia.ts`
- Create: `server/modes/index.ts`
- Test: `server/modes/index.test.ts`
- Modify: `server/hub.ts` (constructor only)

**Interfaces:**
- Consumes: `GameState`/`OptionSpec`/`GameInfo` from Task 1.
- Produces: `GameModule`, `ItemDef`, `ItemGrant` types; `moduleFor(id): GameModule`, `knownModule(id): boolean`, `catalog(): GameInfo[]`, `sanitizeOptions(specs, raw): Record<string, unknown>`. Consumed by Tasks 3–7, 10.

- [ ] **Step 1: Write the failing test**

`server/modes/index.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog, knownModule, moduleFor, sanitizeOptions } from './index.ts'
import type { OptionSpec } from '../../shared/protocol.ts'

test('unknown module ids fall back to trivia, and knownModule says so', () => {
  assert.equal(moduleFor('nope').id, 'trivia')
  assert.equal(knownModule('nope'), false)
  assert.equal(knownModule('trivia'), true)
})

test('catalog lists the registered modules with their option specs', () => {
  const games = catalog()
  assert.ok(games.some((g) => g.id === 'trivia'))
  assert.deepEqual(games.find((g) => g.id === 'trivia')?.options, [])
})

const SPECS: OptionSpec[] = [
  { kind: 'int', key: 'n', label: 'N', default: 5, min: 0, max: 10 },
  { kind: 'bool', key: 'b', label: 'B', default: true },
  { kind: 'choice', key: 'c', label: 'C', default: 'x', choices: ['x', 'y'] },
]

test('sanitizeOptions fills defaults and coerces junk into range', () => {
  assert.deepEqual(sanitizeOptions(SPECS, {}), { n: 5, b: true, c: 'x' })
  assert.deepEqual(sanitizeOptions(SPECS, { n: 99, b: 'yes', c: 'z' }), {
    n: 10,
    b: true,
    c: 'x',
  })
  assert.deepEqual(sanitizeOptions(SPECS, { n: -4, b: false, c: 'y' }), {
    n: 0,
    b: false,
    c: 'y',
  })
  assert.deepEqual(sanitizeOptions(SPECS, { n: 3.7 }), { n: 4, b: true, c: 'x' })
})
```

Run: `node --test server/modes/index.test.ts`
Expected: FAIL — cannot find module `./index.ts`.

- [ ] **Step 2: `shared/modes/types.ts`**

```ts
import type { OptionSpec, PlayerId, State } from '../protocol.ts'

/** An item drop a module declares and the framework executes. */
export type ItemGrant = { playerId: PlayerId; itemId: string }

/**
 * A game mode. Every hook is optional; a module defining none is today's
 * game. There is deliberately no mid-session lifecycle (modes are fixed per
 * session), no event bus, and no per-module HostAction types — module-specific
 * host ops ride the `act` channel through `onAct`, with the role checked by
 * the hub.
 */
export type GameModule = {
  id: string
  name: string
  options: OptionSpec[]
  init(options: Record<string, unknown>): unknown
  /** Why this player may not buzz, or null. Runs at buzz time. */
  canBuzz?(state: State, playerId: PlayerId): string | null
  /** Scoring and `round.award` when the leader is right. Default: leader gets round.value. */
  onCorrect?(state: State): void
  /** Neg scoring and lockout when the leader is wrong. `neg` is what the host sent; 0 always means no penalty. */
  onWrong?(state: State, neg: number): void
  /** Fresh-question reset, called on `arm` only — never on a `wrong` rebound. */
  onArm?(state: State): void
  /** A host-scoped act. Return true if handled. */
  onAct?(state: State, act: string, data?: unknown): boolean
  /** What a viewer may see of moduleState. Absent: players see nothing, host/board see it raw. */
  viewModuleState?(state: State, viewer: PlayerId | 'host' | 'board'): unknown
  /** Item drops after a correct answer, declared as data. */
  grants?(state: State): ItemGrant[]
}

/**
 * A boon/sabotage. Framework-level, so items compose with any mode and never
 * invent their own message type — firing rides the `act` channel.
 */
export type ItemDef = {
  id: string
  name: string
  target: 'self' | 'opponent'
  usableWhen(state: State, userId: PlayerId): boolean
  apply(state: State, userId: PlayerId, targetId?: PlayerId): void
}
```

- [ ] **Step 3: `server/modes/trivia.ts`**

```ts
import type { GameModule } from '../../shared/modes/types.ts'

/**
 * Today's game, as a module: no hooks, no options, no module state. Every
 * framework default exists so that this module can be empty — current
 * behavior is the default, not a special case.
 */
export const trivia: GameModule = {
  id: 'trivia',
  name: 'Trivia',
  options: [],
  init: () => ({}),
}
```

- [ ] **Step 4: `server/modes/index.ts`**

```ts
import type { GameInfo, OptionSpec } from '../../shared/protocol.ts'
import type { GameModule } from '../../shared/modes/types.ts'
import { trivia } from './trivia.ts'

const MODULES: GameModule[] = [trivia]

/** The module behind a game id. Unknown ids fall back to trivia, so a snapshot written by another build still boots. */
export function moduleFor(id: string): GameModule {
  return MODULES.find((m) => m.id === id) ?? trivia
}

export function knownModule(id: string): boolean {
  return MODULES.some((m) => m.id === id)
}

/** The static catalog the host's settings form is rendered from. */
export function catalog(): GameInfo[] {
  return MODULES.map((m) => ({ id: m.id, name: m.name, options: m.options }))
}

/** Fill defaults and coerce junk into range, so modules can trust their options. */
export function sanitizeOptions(
  specs: OptionSpec[],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const v = raw[spec.key]
    if (spec.kind === 'int') {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : spec.default
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, n))
    } else if (spec.kind === 'bool') {
      out[spec.key] = typeof v === 'boolean' ? v : spec.default
    } else {
      out[spec.key] = typeof v === 'string' && spec.choices.includes(v) ? v : spec.default
    }
  }
  return out
}
```

- [ ] **Step 5: Refresh the catalog at startup — `server/hub.ts` constructor**

Add the import and one line:

```ts
import { catalog } from './modes/index.ts'
```

```ts
constructor(state: State, opts: HubOpts = {}) {
  this.state = state
  // The catalog rides the state payload so the host form needs no fetch of
  // its own. Refresh on boot: a snapshot's copy may come from an older build.
  this.state.games = catalog()
  this.revealMs = opts.revealMs ?? REVEAL_MS
  // ...rest unchanged
}
```

- [ ] **Step 6: Verify**

Run: `node --test server/modes/index.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/modes/types.ts server/modes/ server/hub.ts
git commit -m "feat: game module interface, trivia module, and the registry"
```

---

### Task 3: `setGame` and snapshot migration

**Files:**
- Modify: `server/state.ts`
- Test: `server/state.test.ts` (new)

**Interfaces:**
- Consumes: `moduleFor`, `knownModule`, `sanitizeOptions` (Task 2).
- Produces: `applyHostAction` handles `setGame`; `loadState` backfills `game`/`items`/`effects` and falls back to trivia on unknown ids.

- [ ] **Step 1: Write the failing test**

`server/state.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyHostAction, loadState, newState } from './state.ts'
import type { State } from '../shared/protocol.ts'

function withPlayer(state: State): string {
  state.players.push({ id: 'p1', name: 'Ada', connected: true })
  state.scores.p1 = 300
  return 'p1'
}

test('setGame with the current id updates options and keeps scores', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.equal(state.scores.p1, 300)
  assert.equal(state.game.id, 'trivia')
})

test('setGame with an unknown id is dropped, logged, and changes nothing', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setGame', id: 'nope', options: {} })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.scores.p1, 300)
})

test('setGame is refused unless the round is IDLE', () => {
  const state = newState()
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.equal(state.round.phase, 'ARMED')
})

test('loadState backfills snapshots from before game modes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const old = {
      mode: 'solo',
      players: [{ id: 'p1', name: 'Ada', connected: true }],
      teams: [],
      scores: { p1: 700 },
      round: { value: 100, phase: 'LOCKED', armedAt: 5, order: [], total: 0, lockedOut: [] },
    }
    writeFileSync(path, JSON.stringify(old))
    const loaded = loadState(path)
    assert.equal(loaded.game.id, 'trivia')
    assert.deepEqual(loaded.items, {})
    assert.deepEqual(loaded.effects, [])
    assert.equal(loaded.scores.p1, 700)
    assert.equal(loaded.round.phase, 'IDLE', 'the standing mid-flight reset still applies')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadState falls back to trivia when the snapshot names an unregistered game', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = newState() as State & { game: { id: string } }
    state.game.id = 'showdown'
    writeFileSync(path, JSON.stringify(state))
    assert.equal(loadState(path).game.id, 'trivia')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

Run: `node --test server/state.test.ts`
Expected: FAIL — `setGame` is not handled, backfill missing.

- [ ] **Step 2: Implement `setGame` in `server/state.ts`**

Add imports:

```ts
import { knownModule, moduleFor, sanitizeOptions } from './modes/index.ts'
```

Add the case to `applyHostAction`, before `case 'setValue':` (position within the switch is irrelevant; near the other game-level actions reads best):

```ts
    case 'setGame': {
      // Modes are fixed per session; switching is a fresh game, refused mid-question.
      if (round.phase !== 'IDLE') return
      if (!knownModule(action.id)) {
        console.warn(`[state] unknown game "${action.id}" — dropped`)
        return
      }
      const mod = moduleFor(action.id)
      const options = sanitizeOptions(mod.options, action.options)
      if (action.id === state.game.id) {
        // Re-saving the current mode's options is not a switch: scores survive.
        state.game.options = options
        return
      }
      state.game = { id: mod.id, options, moduleState: mod.init(options) }
      state.scores = {}
      state.items = {}
      state.effects = []
      round.armedAt = 0
      round.order = []
      round.total = 0
      round.lockedOut = []
      delete round.award
      delete round.fragments
      delete round.answer
      return
    }
```

- [ ] **Step 3: Backfill in `loadState`**

Inside the `try`, immediately after `const loaded = JSON.parse(raw) as State`:

```ts
    // Snapshots from before game modes — or naming a module this build does
    // not register — must still boot.
    loaded.items ??= {}
    loaded.effects ??= []
    loaded.game ??= { id: 'trivia', options: {}, moduleState: {} }
    if (!knownModule(loaded.game.id)) {
      console.error(
        `[state] game "${loaded.game.id}" is not registered — falling back to trivia`,
      )
      loaded.game = { id: 'trivia', options: {}, moduleState: {} }
    }
```

And alongside the existing mid-flight round reset, add:

```ts
    delete loaded.round.fragments
    delete loaded.round.answer
```

(The hub's constructor refreshes `loaded.games`, so `loadState` need not.)

- [ ] **Step 4: Verify**

Run: `node --test server/state.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/state.ts server/state.test.ts
git commit -m "feat: setGame switches modes and resets the game; snapshots migrate"
```

---

### Task 4: Hook application and the effect lifecycle in the state machine

**Files:**
- Modify: `server/state.ts`
- Test: `server/state.test.ts` (append)

**Interfaces:**
- Consumes: `GameModule` hooks (Task 2).
- Produces: `buzzBlockReason(state, playerId): string | null` (hub, Task 7; steal, Task 5); exported `bump(state, key, delta)` (quizbowl, Task 6); arm/wrong effect stamping. NOTE: `grants` execution in `correct` is deliberately deferred to Task 6 (needs `executeGrants` from Task 5's items.ts).

- [ ] **Step 1: Write the failing tests**

Append to `server/state.test.ts`:

```ts
test('arm sweeps last question\'s effects and stamps the live ones', () => {
  const state = newState()
  state.effects = [
    { kind: 'frozen', playerId: 'old', roundArmedAt: 123 },
    { kind: 'frozen', playerId: 'fresh' },
  ]
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(
    state.effects,
    [{ kind: 'frozen', playerId: 'fresh', roundArmedAt: state.round.armedAt }],
  )
})

test('a wrong rebound re-stamps effects to the new arm instead of sweeping them', () => {
  const state = newState()
  withPlayer(state)
  state.effects = [{ kind: 'frozen', playerId: 'p1', roundArmedAt: state.round.armedAt }]
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.round.phase, 'ARMED')
  assert.equal(state.effects.length, 1)
  assert.equal(state.effects[0].roundArmedAt, state.round.armedAt)
})

test('buzzBlockReason bars a frozen player for exactly the stamped round', async () => {
  const { buzzBlockReason } = await import('./state.ts')
  const state = newState()
  state.round.phase = 'ARMED'
  state.round.armedAt = 999
  state.effects = [{ kind: 'frozen', playerId: 'p1', roundArmedAt: 999 }]
  assert.equal(buzzBlockReason(state, 'p1'), 'frozen')
  assert.equal(buzzBlockReason(state, 'p2'), null)
  state.effects[0].roundArmedAt = 888
  assert.equal(buzzBlockReason(state, 'p1'), null, 'a freeze from another round is inert')
})

test('correct and wrong keep today\'s scoring when the module defines no hooks', () => {
  const state = newState()
  withPlayer(state)
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 400, '300 + the round value of 100')
  assert.deepEqual(state.round.award, { name: 'Ada', points: 100 })
})
```

(Also make `buzzBlockReason` a static import at the top with the other state imports once it exists — the dynamic import above is only so this task's test file parses before the export lands; replace it in Step 3.)

Run: `node --test server/state.test.ts`
Expected: FAIL — no effect handling, no `buzzBlockReason` export.

- [ ] **Step 2: Implement in `server/state.ts`**

Export `bump` (change `function bump` to `export function bump`).

Add `buzzBlockReason` after `lockedPlayerIds`:

```ts
/**
 * Why a player may not buzz right now, or null. Framework effects first — a
 * frozen player is frozen in every mode — then the module's own rules.
 */
export function buzzBlockReason(state: State, playerId: PlayerId): string | null {
  const frozen = state.effects.some(
    (e) =>
      e.kind === 'frozen' &&
      e.playerId === playerId &&
      e.roundArmedAt === state.round.armedAt,
  )
  if (frozen) return 'frozen'
  return moduleFor(state.game.id).canBuzz?.(state, playerId) ?? null
}
```

Rewrite the `arm` case:

```ts
    case 'arm': {
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.total = 0
      delete round.award
      delete round.fragments
      delete round.answer
      // A fresh question: sweep effects stamped to the last one, stamp the
      // live ones (a freeze fired between questions lands here).
      state.effects = state.effects.filter((e) => e.roundArmedAt === undefined)
      for (const e of state.effects) e.roundArmedAt = round.armedAt
      moduleFor(state.game.id).onArm?.(state)
      return
    }
```

Rewrite the `correct` case (hook replaces default scoring and award):

```ts
    case 'correct': {
      // Judging waits for the window: a provisional leader is on the board
      // from 150ms in, but scoring during COLLECTING would strand every buzz
      // still in the air and cut the timeline the room is watching.
      if (!leader || round.phase !== 'LOCKED') return
      const mod = moduleFor(state.game.id)
      if (mod.onCorrect) {
        mod.onCorrect(state)
      } else {
        bump(state, scoreKey(state, leader.playerId), round.value)
        // The order stays up. Clearing it here is what made the result vanish
        // at the exact moment the room looked at it; `arm` and `next` clear it.
        round.award = { name: leader.name, points: round.value }
      }
      round.phase = 'IDLE'
      round.lockedOut = []
      return
    }
```

Rewrite the `wrong` case (hook owns neg + lockout; framework owns the rebound and re-stamps effects rather than sweeping):

```ts
    case 'wrong': {
      if (!leader || round.phase !== 'LOCKED') return
      const key = scoreKey(state, leader.playerId)
      const mod = moduleFor(state.game.id)
      if (mod.onWrong) {
        mod.onWrong(state, action.neg)
      } else {
        if (action.neg) bump(state, key, -action.neg)
        if (!round.lockedOut.includes(key)) round.lockedOut.push(key)
      }
      // Rebound: reopen the buzzers for everyone not locked out. The question
      // is still live, so effects ride along under the new arm instant.
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.total = 0
      delete round.award
      for (const e of state.effects) e.roundArmedAt = round.armedAt
      return
    }
```

Extend `next`/`resetRound` to clear the question text:

```ts
    case 'next':
    case 'resetRound':
      round.phase = 'IDLE'
      round.armedAt = 0
      round.order = []
      round.total = 0
      round.lockedOut = []
      delete round.award
      delete round.fragments
      delete round.answer
      return
```

- [ ] **Step 3: Replace the dynamic import in the test**

Move `buzzBlockReason` into the top-level import and drop `async`/`await` from that test.

- [ ] **Step 4: Verify**

Run: `node --test server/state.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/state.ts server/state.test.ts
git commit -m "feat: module hooks in the round state machine, effect lifecycle on arm"
```

---

### Task 5: The item layer

**Files:**
- Create: `server/items.ts`
- Test: `server/items.test.ts`

**Interfaces:**
- Consumes: `buzzBlockReason`, `scoreKey` from state.ts (Task 4); `ItemDef`, `ItemGrant` (Task 2).
- Produces: `ITEMS: ItemDef[]`, `useItem(state, userId, data): boolean`, `executeGrants(state, grants): void`, `randomItemId(): string`. Consumed by hub (Task 7) and quizbowl (Task 6).

- [ ] **Step 1: Write the failing test**

`server/items.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeGrants, ITEMS, useItem } from './items.ts'
import { newState } from './state.ts'
import type { State } from '../shared/protocol.ts'

function twoPlayers(): State {
  const state = newState()
  state.players.push(
    { id: 'p1', name: 'Ada', connected: true },
    { id: 'p2', name: 'Bo', connected: true },
  )
  return state
}

test('using an item you do not hold changes nothing', () => {
  const state = twoPlayers()
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), false)
  assert.deepEqual(state.effects, [])
})

test('freeze marks the target for the next question and is consumed', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), true)
  assert.deepEqual(state.effects, [{ kind: 'frozen', playerId: 'p2' }])
  assert.deepEqual(state.items.p1, [])
})

test('freeze cannot be fired mid-question', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  state.round.phase = 'COLLECTING'
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), false)
  assert.deepEqual(state.items.p1, ['freeze'], 'a refused use consumes nothing')
})

test('a held shield eats the freeze aimed at its holder', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  state.items.p2 = ['shield']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), true)
  assert.deepEqual(state.effects, [], 'no freeze landed')
  assert.deepEqual(state.items.p2, [], 'the shield was spent')
})

test('shield is passive: it can never be fired by hand', () => {
  const state = twoPlayers()
  state.items.p1 = ['shield']
  assert.equal(useItem(state, 'p1', { itemId: 'shield' }), false)
  assert.deepEqual(state.items.p1, ['shield'])
})

test('steal only works on a rebound, and stamps this arm', () => {
  const state = twoPlayers()
  state.items.p2 = ['steal']
  state.round.phase = 'COLLECTING'
  state.round.armedAt = 50
  // First asking: nobody is locked out, so there is nothing to steal.
  assert.equal(useItem(state, 'p2', { itemId: 'steal' }), false)
  // Rebound: p1 answered wrong and is locked out; p2 jumps the queue.
  state.round.lockedOut = ['p1']
  assert.equal(useItem(state, 'p2', { itemId: 'steal' }), true)
  assert.deepEqual(state.effects, [{ kind: 'steal', playerId: 'p2', roundArmedAt: 50 }])
})

test('the locked-out player cannot steal their own rebound', () => {
  const state = twoPlayers()
  state.items.p1 = ['steal']
  state.round.phase = 'COLLECTING'
  state.round.armedAt = 50
  state.round.lockedOut = ['p1']
  assert.equal(useItem(state, 'p1', { itemId: 'steal' }), false)
})

test('freeze refuses a target that is missing, yourself, or absent', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze' }), false)
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p1' }), false)
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'ghost' }), false)
  assert.deepEqual(state.items.p1, ['freeze'])
})

test('executeGrants fills inventories and skips junk', () => {
  const state = twoPlayers()
  executeGrants(state, [
    { playerId: 'p1', itemId: 'freeze' },
    { playerId: 'p1', itemId: 'freeze' },
    { playerId: 'ghost', itemId: 'steal' },
    { playerId: 'p2', itemId: 'bogus' },
  ])
  assert.deepEqual(state.items.p1, ['freeze', 'freeze'])
  assert.equal(state.items.p2, undefined)
  assert.equal(state.items.ghost, undefined)
})
```

Run: `node --test server/items.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: `server/items.ts`**

```ts
/**
 * Boons and sabotage. Framework-level so items compose with any mode: modes
 * never learn items exist, and items never learn which mode dealt them.
 * Firing rides the `act` channel (`useItem`); validation failure consumes
 * nothing and is silent to the room.
 *
 * The display names are mirrored in client/Player.tsx's ITEM_INFO — the wire
 * carries only ids, and three items do not justify a catalog channel.
 */
import type { ActiveEffect, PlayerId, State } from '../shared/protocol.ts'
import type { ItemDef, ItemGrant } from '../shared/modes/types.ts'
import { buzzBlockReason, scoreKey } from './state.ts'

export const ITEMS: ItemDef[] = [
  {
    id: 'freeze',
    name: 'Freeze',
    target: 'opponent',
    // Fires between questions and lands on the next arm. During ARMED the
    // thumbs are already down — a freeze then would be a race, not a boon.
    usableWhen: (state) => state.round.phase === 'IDLE',
    apply(state, _userId, targetId) {
      const held = state.items[targetId!]
      const shield = held?.indexOf('shield') ?? -1
      if (held && shield >= 0) {
        // The shield is passive: it eats the freeze and is spent.
        held.splice(shield, 1)
        if (held.length === 0) delete state.items[targetId!]
        return
      }
      const effect: ActiveEffect = { kind: 'frozen', playerId: targetId! }
      state.effects.push(effect)
    },
  },
  {
    id: 'shield',
    name: 'Shield',
    target: 'self',
    // Never fired by hand; freeze's apply finds it in the target's inventory.
    usableWhen: () => false,
    apply() {},
  },
  {
    id: 'steal',
    name: 'Steal',
    target: 'self',
    usableWhen: (state, userId) => {
      const round = state.round
      if (round.phase !== 'ARMED' && round.phase !== 'COLLECTING') return false
      if (round.lockedOut.length === 0) return false // rebounds only
      // trivia defines no canBuzz, so buzzBlockReason never consults
      // lockedOut — the thief checks the lockout list for themselves.
      if (round.lockedOut.includes(scoreKey(state, userId))) return false
      if (round.order.some((b) => b.playerId === userId)) return false
      if (
        state.effects.some(
          (e) => e.kind === 'steal' && e.roundArmedAt === round.armedAt,
        )
      )
        return false
      return buzzBlockReason(state, userId) === null
    },
    // An effect, not an order mutation: round.order is republished from the
    // raw buzzes on every packet, so anything written there directly is
    // clobbered. The hub's publish prepends the thief.
    apply: (state, userId) => {
      state.effects.push({
        kind: 'steal',
        playerId: userId,
        roundArmedAt: state.round.armedAt,
      })
    },
  },
]

export function randomItemId(): string {
  return ITEMS[Math.floor(Math.random() * ITEMS.length)].id
}

/**
 * Fire an item from a player's `act` message. Validates inventory,
 * `usableWhen`, and target before `apply` runs; returns false and consumes
 * nothing on any failure.
 */
export function useItem(state: State, userId: PlayerId, data: unknown): boolean {
  const { itemId, targetId } = (data ?? {}) as Record<string, unknown>
  const def = ITEMS.find((i) => i.id === itemId)
  if (!def) return false
  const held = state.items[userId]
  const at = held?.indexOf(def.id) ?? -1
  if (!held || at < 0) return false
  if (!def.usableWhen(state, userId)) return false
  if (def.target === 'opponent') {
    if (typeof targetId !== 'string') return false
    if (targetId === userId) return false
    if (!state.players.some((p) => p.id === targetId)) return false
  }
  def.apply(state, userId, targetId as string | undefined)
  held.splice(at, 1)
  if (held.length === 0) delete state.items[userId]
  return true
}

/** Modules declare drops; the framework executes them. */
export function executeGrants(state: State, grants: ItemGrant[]): void {
  for (const g of grants) {
    if (!ITEMS.some((i) => i.id === g.itemId)) continue
    if (!state.players.some((p) => p.id === g.playerId)) continue
    ;(state.items[g.playerId] ??= []).push(g.itemId)
  }
}
```

`buzzBlockReason` and `scoreKey` are both used: the lockout check above needs
`scoreKey` because the team's key, not the player id, is what lands in
`lockedOut`.

- [ ] **Step 3: Verify**

Run: `node --test server/items.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/items.ts server/items.test.ts
git commit -m "feat: item layer — freeze, shield, steal"
```

---

### Task 6: Quizbowl-lite, the proving module

**Files:**
- Create: `server/modes/quizbowl.ts`
- Test: `server/modes/quizbowl.test.ts`
- Modify: `server/modes/index.ts` (register), `server/state.ts` (grants line)

**Interfaces:**
- Consumes: `bump`, `scoreKey` (Task 4); `executeGrants`, `randomItemId`, `ITEMS` (Task 5).
- Produces: the `quizbowl` module; `correct` now executes `mod.grants`.

- [ ] **Step 1: Write the failing test**

`server/modes/quizbowl.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyHostAction, newState } from '../state.ts'
import { moduleFor } from './index.ts'
import { ITEMS } from '../items.ts'
import type { State } from '../../shared/protocol.ts'

function quizbowlState(options: Record<string, unknown> = {}): State {
  const state = newState()
  applyHostAction(state, {
    a: 'setGame',
    id: 'quizbowl',
    options: { powerAfterFragment: 2, powerBonus: 50, neg: 50, ...options },
  })
  state.players.push(
    { id: 'p1', name: 'Ada', connected: true },
    { id: 'p2', name: 'Bo', connected: true },
  )
  return state
}

/** Drive a round to LOCKED with p1 leading at `at`. */
function locked(state: State, at: number): void {
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at, deltaMs: 0 }]
}

test('registration and option sanitizing', () => {
  const state = quizbowlState()
  assert.equal(state.game.id, 'quizbowl')
  assert.equal(state.game.options.powerBonus, 50)
  const over = newState()
  applyHostAction(over, { a: 'setGame', id: 'quizbowl', options: { powerBonus: 99999 } })
  assert.equal(over.game.options.powerBonus, 500, 'clamped to the spec max')
})

test('switching modes resets scores, items, effects, and the round', () => {
  const state = quizbowlState()
  state.scores.p1 = 500
  state.items.p1 = ['freeze']
  state.effects = [{ kind: 'frozen', playerId: 'p2' }]
  state.round.fragments = ['half a question']
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.deepEqual(state.scores, {})
  assert.deepEqual(state.items, {})
  assert.deepEqual(state.effects, [])
  assert.equal(state.round.fragments, undefined)
})

test('a buzz before the power cutoff scores value + bonus', () => {
  const state = quizbowlState()
  state.round.value = 200
  const mod = moduleFor('quizbowl')
  state.round.phase = 'ARMED'
  state.round.armedAt = 1000
  mod.onAct!(state, 'powerEnds') // powerEndsAt = now, after the buzz below
  ;(state.game.moduleState as { powerEndsAt: number }).powerEndsAt = 1500
  locked(state, 1200)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 250)
  assert.deepEqual(state.round.award, { name: 'Ada', points: 250 })
})

test('a buzz after the cutoff scores the plain value', () => {
  const state = quizbowlState()
  state.round.value = 200
  ;(state.game.moduleState as { powerEndsAt?: number }).powerEndsAt = 1500
  locked(state, 1600)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 200)
})

test('no signal at all: power stays open the whole question', () => {
  const state = quizbowlState()
  state.round.value = 200
  locked(state, 99999)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 250, 'graceful degradation: everything is a power')
})

test('powerAfterFragment 0 turns powers off', () => {
  const state = quizbowlState({ powerAfterFragment: 0 })
  state.round.value = 200
  locked(state, 1)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 200)
})

test('arm clears the power signal; a rebound keeps it', () => {
  const state = quizbowlState()
  const ms = state.game.moduleState as { powerEndsAt?: number }
  ms.powerEndsAt = 1234
  applyHostAction(state, { a: 'arm' })
  assert.equal(ms.powerEndsAt, undefined)

  ms.powerEndsAt = 1234
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(ms.powerEndsAt, 1234, 'the rebound is still the same question')
})

test('wrong applies the configured neg and locks out, whatever the host sent', () => {
  const state = quizbowlState()
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 200 })
  assert.equal(state.scores.p1, -50, 'the module\'s neg wins')
  assert.deepEqual(state.round.lockedOut, ['p1'])
  assert.equal(state.round.phase, 'ARMED', 'rebound')
})

test('the host\'s no-penalty button (neg 0) always means it', () => {
  const state = quizbowlState()
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.scores.p1, 0)
})

test('bouncebacks off: the wrong answerer is not locked out', () => {
  const state = quizbowlState({ bouncebacks: false })
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.round.lockedOut, [])
})

test('a correct answer grants the leader one random item when items are on', () => {
  const state = quizbowlState({ itemsEnabled: true })
  locked(state, 1)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.items.p1?.length, 1)
  assert.ok(ITEMS.some((i) => i.id === state.items.p1[0]))
})

test('no grants when items are off, and trivia never grants', () => {
  const off = quizbowlState()
  locked(off, 1)
  applyHostAction(off, { a: 'correct' })
  assert.deepEqual(off.items, {})

  const trivia = newState()
  trivia.players.push({ id: 'p1', name: 'Ada', connected: true })
  trivia.round.phase = 'LOCKED'
  trivia.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(trivia, { a: 'correct' })
  assert.deepEqual(trivia.items, {})
})

test('onAct ignores acts it does not own', () => {
  const state = quizbowlState()
  assert.equal(moduleFor('quizbowl').onAct!(state, 'bogus'), false)
})

test('quizbowl exposes no module state to players', () => {
  const mod = moduleFor('quizbowl')
  assert.equal(mod.viewModuleState, undefined, 'the framework default hides it from phones')
})
```

Run: `node --test server/modes/quizbowl.test.ts`
Expected: FAIL — module unregistered / missing.

- [ ] **Step 2: `server/modes/quizbowl.ts`**

```ts
/**
 * Quizbowl-lite: powers, negs, bouncebacks, and item drops.
 *
 * Power is a signal, not a timer. A reader (`npm run read`) fires the
 * host-scoped `powerEnds` act when it finishes speaking the power fragment;
 * a buzz whose clamped press time beats that stamp is powered. Press times
 * are already clamped to [armedAt, arrivedAt], so no phone can backdate into
 * the window. Until any reader fires, power stays open the whole question —
 * graceful degradation to "everything is a power", visible on the host.
 */
import type { GameModule } from '../../shared/modes/types.ts'
import type { State } from '../../shared/protocol.ts'
import { bump, scoreKey } from '../state.ts'
import { randomItemId } from '../items.ts'

type QuizbowlState = { powerEndsAt?: number }

const ms = (state: State) => state.game.moduleState as QuizbowlState

export const quizbowl: GameModule = {
  id: 'quizbowl',
  name: 'Quizbowl-lite',
  options: [
    {
      kind: 'int',
      key: 'powerAfterFragment',
      label: 'Power ends after fragment (0 = powers off)',
      default: 2,
      min: 0,
      max: 9,
    },
    { kind: 'int', key: 'powerBonus', label: 'Power bonus', default: 50, min: 0, max: 500 },
    { kind: 'int', key: 'neg', label: 'Wrong-answer penalty', default: 0, min: 0, max: 500 },
    {
      kind: 'bool',
      key: 'bouncebacks',
      label: 'Bouncebacks (wrong answerers sit out the rebound)',
      default: true,
    },
    { kind: 'bool', key: 'itemsEnabled', label: 'Item drops', default: false },
  ],

  init: () => ({}),

  // The power cutoff belongs to the question, not the arm: a `wrong` rebound
  // re-arms but keeps it, so rebound buzzes are correctly unpowered.
  onArm: (state) => {
    ms(state).powerEndsAt = undefined
  },

  onAct(state, act) {
    if (act !== 'powerEnds') return false
    ms(state).powerEndsAt = Date.now()
    return true
  },

  onCorrect(state) {
    const leader = state.round.order[0]
    if (!leader) return
    const cutoff = ms(state).powerEndsAt
    const powered =
      Number(state.game.options.powerAfterFragment ?? 0) > 0 &&
      (cutoff === undefined || leader.at < cutoff)
    const points =
      state.round.value + (powered ? Number(state.game.options.powerBonus ?? 0) : 0)
    bump(state, scoreKey(state, leader.playerId), points)
    state.round.award = { name: leader.name, points }
  },

  onWrong(state, neg) {
    const leader = state.round.order[0]
    if (!leader) return
    const key = scoreKey(state, leader.playerId)
    // The host's "no penalty" button sends 0 and always means it; otherwise
    // the module's configured neg wins over whatever the button said.
    const penalty = neg === 0 ? 0 : Number(state.game.options.neg ?? 0)
    if (penalty) bump(state, key, -penalty)
    if (state.game.options.bouncebacks !== false) {
      if (!state.round.lockedOut.includes(key)) state.round.lockedOut.push(key)
    }
  },

  grants(state) {
    if (state.game.options.itemsEnabled !== true) return []
    const leader = state.round.order[0]
    if (!leader) return []
    return [{ playerId: leader.playerId, itemId: randomItemId() }]
  },

  // No viewModuleState: the framework default shows host/board the raw blob
  // (the host's power chip reads it) and hides it from phones.
}
```

Register it in `server/modes/index.ts`:

```ts
import { quizbowl } from './quizbowl.ts'

const MODULES: GameModule[] = [trivia, quizbowl]
```

- [ ] **Step 3: Wire grants into `correct` in `server/state.ts`**

Add the import and the line at the end of the `correct` case:

```ts
import { executeGrants } from './items.ts'
```

```ts
      round.phase = 'IDLE'
      round.lockedOut = []
      if (mod.grants) executeGrants(state, mod.grants(state))
      return
```

- [ ] **Step 4: Verify**

Run: `node --test server/modes/quizbowl.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modes/quizbowl.ts server/modes/quizbowl.test.ts server/modes/index.ts server/state.ts
git commit -m "feat: quizbowl-lite — powers by signal, negs, bouncebacks, item drops"
```

---

### Task 7: Hub wiring — acts, buzz gating, steal, redaction

**Files:**
- Modify: `server/hub.ts`
- Test: `server/hub.test.ts` (new)

**Interfaces:**
- Consumes: `useItem` (Task 5), `buzzBlockReason` (Task 4), `moduleFor` (Task 2).
- Produces: hub handles `act` messages; frozen players cannot buzz; steal prepends in `publish`; `viewFor` strips fragments/answer/moduleState from players. Consumed by Tasks 11–15.

- [ ] **Step 1: Write the failing test**

`server/hub.test.ts`:

```ts
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
```

Steal's publish behavior is timing-bound (it needs a live collection window), so it is covered by the Task 15 integration test over real sockets, not here.

Run: `node --test server/hub.test.ts`
Expected: FAIL — `act` unhandled, no gating, no stripping.

- [ ] **Step 2: Implement in `server/hub.ts`**

Add imports:

```ts
import { buzzBlockReason } from './state.ts'
import { moduleFor } from './modes/index.ts'
import { useItem } from './items.ts'
```

Add to the `handle` switch, after `case 'host':`'s block:

```ts
      case 'act':
        this.act(conn, msg.act, msg.data)
        return
```

Add the class members and the `act` method:

```ts
  /** Unknown acts, so each is logged once rather than per packet. */
  private unknownActs = new Set<string>()

  /**
   * Module and item actions. Items belong to players; everything else is
   * host-scoped — the reader tool connects as host, and a phone must not be
   * able to reveal a fragment early or close the power window for itself.
   */
  private act(conn: Conn, name: string, data: unknown): void {
    if (name === 'useItem') {
      if (!conn.playerId) return
      if (useItem(this.state, conn.playerId, data)) {
        if (this.revealed) this.publish()
        this.changed()
      }
      return
    }
    if (conn.role !== 'host') return
    const round = this.state.round
    if (name === 'fragment' && typeof data === 'string') {
      round.fragments = [...(round.fragments ?? []), data]
    } else if (name === 'revealAnswer' && typeof data === 'string') {
      round.answer = data
    } else {
      const handled = moduleFor(this.state.game.id).onAct?.(this.state, name, data) ?? false
      if (!handled) {
        if (!this.unknownActs.has(name)) {
          this.unknownActs.add(name)
          console.warn(`[hub] unknown act "${name}" — dropped`)
        }
        return
      }
    }
    this.changed()
  }
```

Gate the buzz, in `buzz()` immediately after the pre-fire guard:

```ts
    if (arrivedAt < round.armedAt) return

    // Framework effects (freeze) and the module's own rules both live behind
    // this one question.
    if (buzzBlockReason(this.state, conn.playerId)) return
```

Rewrite `publish()`:

```ts
  /** Resolve what has arrived so far into the published order. */
  private publish(): void {
    const round = this.state.round
    const excluded = lockedPlayerIds(this.state)
    const frozen = new Set(
      this.state.effects
        .filter((e) => e.kind === 'frozen' && e.roundArmedAt === round.armedAt)
        .map((e) => e.playerId),
    )
    round.order = resolveBuzzes(this.pending, round.armedAt, [...excluded, ...frozen]).map(
      (b) => this.entry(b),
    )
    // A steal jumps the window: first place, measured from the arm instant.
    const steal = this.state.effects.find(
      (e) => e.kind === 'steal' && e.roundArmedAt === round.armedAt,
    )
    if (steal && !frozen.has(steal.playerId) && !excluded.includes(steal.playerId)) {
      const name =
        this.state.players.find((p) => p.id === steal.playerId)?.name ?? '?'
      round.order = [
        { playerId: steal.playerId, name, at: round.armedAt, deltaMs: 0 },
        ...round.order.filter((b) => b.playerId !== steal.playerId),
      ].map((b) => ({ ...b, deltaMs: Math.round(b.at - round.armedAt) }))
    }
    round.total = round.order.length
  }
```

Rewrite `viewFor`:

```ts
  /**
   * Phones get the round redacted to their own buzz, question text and answer
   * stripped (the room reads the board; a phone must not leak the next
   * fragment before the voice reaches it), and module state only through the
   * module's own viewModuleState — a module without one exposes nothing.
   */
  viewFor(conn: Conn): State {
    const mod = moduleFor(this.state.game.id)
    let game = this.state.game
    if (mod.viewModuleState) {
      const viewer = conn.role === 'player' ? (conn.playerId ?? '') : conn.role
      game = { ...game, moduleState: mod.viewModuleState(this.state, viewer) }
    } else if (conn.role === 'player') {
      game = { ...game, moduleState: undefined }
    }
    if (conn.role !== 'player') return { ...this.state, game }
    const round = this.state.round
    return {
      ...this.state,
      game,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
        fragments: undefined,
        answer: undefined,
      },
    }
  }
```

(The old comment about redaction is absorbed into the new one.)

- [ ] **Step 3: Verify**

Run: `node --test server/hub.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/hub.ts server/hub.test.ts
git commit -m "feat: act channel, freeze gating, steal, and module redaction in the hub"
```

---

### Task 8: Board — question text and answer

**Files:**
- Modify: `client/Board.tsx`
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `round.fragments`/`round.answer` (server-populated from Task 7).

Client components have no unit-test harness in this repo (`client/sound.test.ts` tests pure logic only); verification here is typecheck + build, then a manual pass with `npm run probe` fragment steps (Task 14) or the reader (Task 13).

- [ ] **Step 1: Render fragments in the mid band**

In `Board.tsx`, replace the middle band's contents:

```tsx
        <div class={leader ? 'board__mid' : 'board__mid board__mid--cue'}>
          {leader ? (
            <p class="board__hero">{leader.name}</p>
          ) : round.fragments?.length ? (
            // The question, assembling as the reader speaks it. Once someone
            // is answering, the stage belongs to them instead.
            <p class="board__question">{round.fragments.join(' ')}</p>
          ) : (
            <p class={open ? 'board__call' : 'board__idle'}>
              {open ? 'Buzz' : armed ? 'Stand by' : 'Ready'}
            </p>
          )}
        </div>
```

- [ ] **Step 2: Show the answer with the award**

In the `board__above` band, after the award line:

```tsx
          {leader && round.award && <p class="board__award">+{round.award.points}</p>}
          {round.award && round.answer && <p class="board__answer">{round.answer}</p>}
```

- [ ] **Step 3: CSS**

Append to `client/style.css`, next to the other `.board__*` rules:

```css
/* The question assembling on the wall, spoken fragment by spoken fragment. */
.board__question {
  font-family: var(--display);
  font-size: var(--t-xl);
  font-weight: 500;
  line-height: 1.25;
  margin: 0;
  padding: 0 var(--s6);
  max-width: 64rem;
  text-align: center;
  color: var(--tungsten);
}
/* The answer, named once the points are on the board. */
.board__answer {
  font-family: var(--display);
  font-size: var(--t-lg);
  font-weight: 700;
  margin: var(--s3) 0 0;
  color: var(--brass);
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/Board.tsx client/style.css
git commit -m "feat: the board reads the question as it is spoken, and names the answer"
```

---

### Task 9: Client surface registry

**Files:**
- Create: `client/modes/index.ts`
- Create: `client/modes/Switch.tsx`
- Modify: `client/main.tsx`

**Interfaces:**
- Produces: `modeSurfaces: Record<string, ModeSurfaces>` and `ModeSwitch`. Consumed by Host (Task 10) and any future module (showdown).

- [ ] **Step 1: `client/modes/index.ts`**

```ts
import type { ComponentType } from 'preact'
import type { HostAction, State } from '../../shared/protocol.ts'

/**
 * A module may replace a surface wholesale. Override components are
 * self-contained: they open their own socket with the surface's role,
 * exactly like the defaults they replace. Trivia and quizbowl register
 * nothing and get the defaults.
 */
export type ModeSurfaces = {
  Player?: ComponentType
  Board?: ComponentType
  /** Replaces the schema-driven settings form on the host screen. */
  Settings?: ComponentType<{ state: State; act: (action: HostAction) => void }>
}

export const modeSurfaces: Record<string, ModeSurfaces> = {}
```

- [ ] **Step 2: `client/modes/Switch.tsx`**

```tsx
import type { ComponentType } from 'preact'
import { useSocket } from '../useSocket.ts'
import { modeSurfaces } from './index.ts'

/**
 * Picks a surface by the active game mode, falling back to the default when
 * the module overrides nothing. Reads state over a passive board-role
 * socket — the switch never joins, never buzzes.
 *
 * ponytail: a phone running a mode override briefly holds two sockets (this
 * one plus the override's own). Harmless on a LAN; thread the socket down as
 * props if a real override ever ships and the extra connection starts to
 * matter.
 */
export function ModeSwitch({
  surface,
  fallback: Fallback,
}: {
  surface: 'Player' | 'Board'
  fallback: ComponentType
}) {
  const { state } = useSocket('board')
  const Override = state ? modeSurfaces[state.game.id]?.[surface] : undefined
  if (Override) return <Override />
  return <Fallback />
}
```

- [ ] **Step 3: `client/main.tsx`**

```tsx
import { render } from 'preact'
import { Player } from './Player.tsx'
import { Host } from './Host.tsx'
import { Board } from './Board.tsx'
import { ModeSwitch } from './modes/Switch.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <Host />
  if (path === '/board') return <ModeSwitch surface="Board" fallback={Board} />
  return <ModeSwitch surface="Player" fallback={Player} />
}

render(<App />, document.getElementById('app')!)
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: PASS. (The registry is empty, so every surface is the default.)

- [ ] **Step 5: Commit**

```bash
git add client/modes/ client/main.tsx
git commit -m "feat: client surface registry with fallback to the defaults"
```

---

### Task 10: Host — schema-driven settings and the power chip

**Files:**
- Create: `client/GameSettings.tsx`
- Modify: `client/Host.tsx`

**Interfaces:**
- Consumes: `state.games` catalog, `setGame` HostAction, `modeSurfaces` (Task 9).

- [ ] **Step 1: `client/GameSettings.tsx`**

```tsx
import type { GameInfo, HostAction, OptionSpec, State } from '../shared/protocol.ts'
import { modeSurfaces } from './modes/index.ts'

function OptionField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: OptionSpec
  value: unknown
  disabled: boolean
  onChange: (v: unknown) => void
}) {
  if (spec.kind === 'int') {
    return (
      <label class="field">
        {spec.label}
        <input
          class="input input--num"
          type="number"
          min={spec.min}
          max={spec.max}
          value={Number(value ?? spec.default)}
          disabled={disabled}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        />
      </label>
    )
  }
  if (spec.kind === 'bool') {
    return (
      <label class="field">
        {spec.label}
        <input
          type="checkbox"
          checked={Boolean(value ?? spec.default)}
          disabled={disabled}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
      </label>
    )
  }
  return (
    <label class="field">
      {spec.label}
      <select
        class="input"
        value={String(value ?? spec.default)}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {spec.choices.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  )
}

function defaultsOf(info: GameInfo): Record<string, unknown> {
  return Object.fromEntries(info.options.map((o) => [o.key, o.default]))
}

/**
 * The one settings form every mode gets for free: it renders itself from the
 * option schema in the state payload. Modes are fixed per session, so the
 * server refuses changes mid-question — the form disables itself to match.
 */
export function GameSettings({
  state,
  act,
}: {
  state: State
  act: (action: HostAction) => void
}) {
  const idle = state.round.phase === 'IDLE'
  const current = state.games.find((g) => g.id === state.game.id)
  const Override = modeSurfaces[state.game.id]?.Settings
  if (Override) return <Override state={state} act={act} />
  if (!current) return null

  const pick = (id: string) => {
    if (id === state.game.id) return
    const next = state.games.find((g) => g.id === id)
    if (!next) return
    const dirty = Object.values(state.scores).some((s) => s !== 0)
    if (dirty && !confirm(`Switch to ${next.name}? Scores and the round reset.`)) return
    act({ a: 'setGame', id, options: defaultsOf(next) })
  }

  return (
    <section>
      <p class="eyebrow">Game</p>
      <label class="field">
        Mode
        <select
          class="input"
          value={state.game.id}
          disabled={!idle}
          onChange={(e) => pick((e.target as HTMLSelectElement).value)}
        >
          {state.games.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      {current.options.map((spec) => (
        <OptionField
          key={spec.key}
          spec={spec}
          value={state.game.options[spec.key]}
          disabled={!idle}
          onChange={(v) =>
            act({ a: 'setGame', id: state.game.id, options: { ...state.game.options, [spec.key]: v } })
          }
        />
      ))}
      {!idle && <p class="muted">Game settings unlock between questions.</p>}
    </section>
  )
}
```

- [ ] **Step 2: Wire it into `client/Host.tsx`**

Import:

```tsx
import { GameSettings } from './GameSettings.tsx'
```

Render it inside the `host__manage` details, directly under the `<summary>` (setup, not play — it belongs with the teams controls, folded away; the spec's "above the existing host controls" is about the settings form existing without per-mode code, and the host screen's one-screen-for-controls rule from the design doc wins):

```tsx
      <details class="host__manage">
        <summary>Players and teams · {state.players.length} joined</summary>

        <GameSettings state={state} act={act} />
```

- [ ] **Step 3: The power chip**

In the `host__bar`, after the phase chip, show whether power is open when the mode uses the signal:

```tsx
        <span class="chip">{round.phase}</span>

        {state.game.id === 'quizbowl' &&
          Number(state.game.options.powerAfterFragment ?? 0) > 0 &&
          (() => {
            const ms = state.game.moduleState as { powerEndsAt?: number } | undefined
            const ended = ms?.powerEndsAt !== undefined
            return (
              <span class={ended ? 'chip chip--barred' : 'chip chip--data'}>
                {ended ? 'Power ended' : 'Power open'}
              </span>
            )
          })()}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: PASS. Manual smoke: `npm start`, open `/host`, switch mode to Quizbowl-lite, watch options render; run a question with the sim and confirm the form disables mid-question.

- [ ] **Step 5: Commit**

```bash
git add client/GameSettings.tsx client/Host.tsx
git commit -m "feat: schema-driven game settings on the host screen, power chip"
```

---

### Task 11: Player — inventory row and the frozen state

**Files:**
- Modify: `client/Player.tsx`
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `state.items`, `state.effects`, `act` ClientMsg (Task 7).

- [ ] **Step 1: Item info mirror and inventory derivation**

At the top of `client/Player.tsx`, after imports:

```tsx
// Mirror of server/items.ts — ids, display names, targeting. The wire carries
// only ids, and three items do not justify a catalog channel.
const ITEM_INFO: Record<string, { name: string; opponent: boolean; passive?: boolean }> = {
  freeze: { name: 'Freeze', opponent: true },
  shield: { name: 'Shield', opponent: false, passive: true },
  steal: { name: 'Steal', opponent: false },
}
```

Inside `Player()`, with the other derived state (above the `if (!ready)` guard, next to `barred`):

```tsx
  const frozen =
    !!state &&
    !!playerId &&
    state.effects.some(
      (e) =>
        e.kind === 'frozen' &&
        e.playerId === playerId &&
        e.roundArmedAt === state.round.armedAt,
    )
  const myItems = state && playerId ? (state.items[playerId] ?? []) : []
  const itemCounts = [...myItems.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())]
  const opponents = state?.players.filter((p) => p.id !== playerId && p.connected) ?? []
  const [targetFor, setTargetFor] = useState<string | null>(null)
```

(The `useState` import is already there. Hooks stay above every early return — `useState` for `targetFor` must sit with the others, not after the join-screen return.)

- [ ] **Step 2: Frozen in the buzzer state machine**

Extend the `buzz` guard and the disabled prop with `|| frozen`:

```tsx
  const buzz = () => {
    if (!open || barred || pressed || frozen) return
    ...
  }
```

```tsx
        disabled={!open || barred || pressed || frozen}
```

Add frozen to the label chain, before the `barred` branch:

```tsx
  if (frozen) {
    label = 'Frozen'
    sub = 'A freeze item shut you out of this question'
    mood = 'is-barred'
  } else if (barred) {
```

And skip the go-cue for a frozen phone — in the `useOpen` callback, change `if (barred) return` to `if (barred || frozen) return`. (`frozen` is derived above the hook call, so this closes over the live value the same way `barred` does.)

- [ ] **Step 3: The inventory row**

Fire helper, next to `buzz`:

```tsx
  const fireItem = (itemId: string, targetId?: string) => {
    send({ t: 'act', act: 'useItem', data: { itemId, targetId } })
    setTargetFor(null)
  }
```

Render between the buzzer and the standings dial:

```tsx
      {itemCounts.length > 0 && (
        <div class="player__items">
          {targetFor ? (
            <>
              <span class="muted">Pick a target</span>
              {opponents.map((p) => (
                <button key={p.id} class="btn" onPointerDown={() => fireItem(targetFor, p.id)}>
                  {p.name}
                </button>
              ))}
              <button class="btn btn--ghost" onPointerDown={() => setTargetFor(null)}>
                Cancel
              </button>
            </>
          ) : (
            itemCounts.map(([id, n]) => {
              const info = ITEM_INFO[id]
              if (!info) return null
              const count = n > 1 ? ` ×${n}` : ''
              // Passive items (shield) show as chips: held, never fired by hand.
              if (info.passive) return <span key={id} class="chip chip--data">{info.name}{count}</span>
              return (
                <button
                  key={id}
                  class="btn"
                  onPointerDown={() => (info.opponent ? setTargetFor(id) : fireItem(id))}
                >
                  {info.name}{count}
                </button>
              )
            })
          )}
        </div>
      )}

      {state && <StandingsDial state={state} />}
```

- [ ] **Step 4: CSS**

Append to `client/style.css` near the other `.player__*` rules:

```css
.player__items {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  margin-top: var(--s4);
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: PASS. Manual smoke comes free with Task 15's integration test plus one phone pass with `npm run sim` (quizbowl grants will put items on the winner's phone).

- [ ] **Step 6: Commit**

```bash
git add client/Player.tsx client/style.css
git commit -m "feat: item inventory on the phone, frozen buzzer state"
```

---

### Task 12: Question pack parser

**Files:**
- Create: `tools/pack.ts`
- Test: `tools/pack.test.ts`
- Modify: `package.json` (test glob)

**Interfaces:**
- Produces: `parsePack(text): { questions: Question[]; errors: string[] }`, `Question = { value?: number; fragments: string[]; answer: string }`. Consumed by the reader (Task 13).

- [ ] **Step 1: Write the failing test**

`tools/pack.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePack } from './pack.ts'

test('a full pack: values, fragments, continuations, answers', () => {
  const { questions, errors } = parsePack(`V: 200
The first fragment, spoken first. / The second fragment, which
ends the power window. / The giveaway.
A: The answer

This one has no value and two fragments. / Second fragment.
A: Another answer
`)
  assert.deepEqual(errors, [])
  assert.equal(questions.length, 2)
  assert.equal(questions[0].value, 200)
  assert.deepEqual(questions[0].fragments, [
    'The first fragment, spoken first.',
    'The second fragment, which ends the power window.',
    'The giveaway.',
  ])
  assert.equal(questions[0].answer, 'The answer')
  assert.equal(questions[1].value, undefined)
  assert.deepEqual(questions[1].fragments, [
    'This one has no value and two fragments.',
    'Second fragment.',
  ])
})

test('a question without an A: line is skipped and the error names the line', () => {
  const { questions, errors } = parsePack(`No answer here. / Still none.

Good question.
A: Yes
`)
  assert.equal(questions.length, 1)
  assert.equal(questions[0].answer, 'Yes')
  assert.equal(errors.length, 1)
  assert.match(errors[0], /line 1/)
})

test('a bad V: line is named and does not kill the question', () => {
  const { questions, errors } = parsePack(`V: lots
Real question.
A: Real answer
`)
  assert.equal(questions.length, 1)
  assert.equal(questions[0].value, undefined)
  assert.match(errors[0], /line 1/)
})

test('an empty pack parses to nothing, no errors', () => {
  assert.deepEqual(parsePack('\n\n'), { questions: [], errors: [] })
})
```

Run: `node --test tools/pack.test.ts`
Expected: FAIL — module missing. (Also not yet in the npm test glob — run it directly.)

- [ ] **Step 2: `tools/pack.ts`**

```ts
/**
 * Bring-your-own questions. Plain text, hand-authorable:
 *
 *   V: 200                          optional; falls back to the round value
 *   First fragment. / Second, which  ` / ` splits fragments
 *   continues the second. / Third.   bare lines join the current fragment
 *   A: The answer                   required, so the host can judge
 *
 *   Blank line separates questions.
 *
 * The reader tool owns the pack; question content never touches the server
 * beyond the fragments it reveals.
 */
export type Question = { value?: number; fragments: string[]; answer: string }
export type PackResult = { questions: Question[]; errors: string[] }

export function parsePack(text: string): PackResult {
  const questions: Question[] = []
  const errors: string[] = []
  let value: number | undefined
  let fragments: string[] = []
  let answer = ''
  let startLine = 0

  const flush = () => {
    if (value === undefined && fragments.length === 0 && !answer) return
    if (fragments.length === 0 || !answer) {
      errors.push(`line ${startLine}: a question needs at least one fragment and an A: line`)
    } else {
      questions.push({ value, fragments, answer })
    }
    value = undefined
    fragments = []
    answer = ''
  }

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const n = i + 1
    if (!line) {
      flush()
      return
    }
    if (line.startsWith('V:')) {
      const v = Number(line.slice(2).trim())
      if (!Number.isFinite(v) || fragments.length > 0 || answer) {
        errors.push(`line ${n}: bad or misplaced V: line`)
        return
      }
      value = v
      startLine = n
      return
    }
    if (line.startsWith('A:')) {
      answer = line.slice(2).trim()
      return
    }
    if (fragments.length === 0) startLine = n
    const parts = line.split(' / ').map((s) => s.trim())
    if (fragments.length === 0) {
      fragments = parts
    } else {
      // The first segment continues the fragment in progress; the rest start new ones.
      fragments[fragments.length - 1] += ` ${parts[0]}`
      fragments.push(...parts.slice(1))
    }
  })
  flush()
  return { questions, errors }
}
```

- [ ] **Step 3: Add the tools glob to `package.json`**

```json
    "test": "node --test 'server/*.test.ts' 'client/*.test.ts' 'tools/*.test.ts'",
```

- [ ] **Step 4: Verify**

Run: `node --test tools/pack.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/pack.ts tools/pack.test.ts package.json
git commit -m "feat: question pack parser"
```

---

### Task 13: The reader — `npm run read`

**Files:**
- Create: `tools/read.ts`
- Create: `tools/sample-pack.txt`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parsePack` (Task 12), `connect` from `tools/conn.ts`, the host-scoped acts `fragment`/`powerEnds`/`revealAnswer` (Task 7), `state.game.options.powerAfterFragment`.

- [ ] **Step 1: `tools/read.ts`**

```ts
/**
 * The reader: speaks a question pack aloud, fragment by fragment, and drives
 * the game in time with its own voice.
 *
 *   npm run read -- pack.txt                  against http://localhost:8080
 *   npm run read -- pack.txt http://box:8080  against another host
 *
 * The pack is this tool's alone — the server never sees question content
 * beyond the fragments the room has heard. Each fragment goes up on the
 * board as it is spoken; when the configured power fragment has been said,
 * the reader fires `powerEnds` and the window closes behind it. No reader,
 * no cutoff: power simply stays open all question.
 *
 * The human host still judges. C and W on the host screen score the round as
 * always — a wrong answer re-arms for a rebound and the reader waits it out
 * (the fragments have all been said). When the question resolves, the answer
 * goes up on the board; the host's N then releases the next question.
 *
 * Speech is macOS `say`. On a machine without it the wire protocol still runs
 * — fragments appear, power closes — just silently.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from './conn.ts'
import { parsePack } from './pack.ts'

const [packPath, argUrl] = process.argv.slice(2)
const URL = argUrl ?? process.env.URL ?? 'http://localhost:8080'

const log = (s = '') => console.log(s)

/** One fragment aloud. Resolves when the voice finishes, or at once without `say`. */
function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('say', [text])
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
}

async function main() {
  if (!packPath) {
    log('\n  usage: npm run read -- pack.txt [url]\n')
    return
  }
  const { questions, errors } = parsePack(readFileSync(packPath, 'utf8'))
  for (const e of errors) log(`  skipped: ${e}`)
  if (questions.length === 0) {
    console.error('\n  no usable questions in the pack\n')
    process.exit(1)
  }

  const host = await connect(URL, 'host')
  // The host releases each question with N; some waits are a room's patience,
  // not a timeout in any meaningful sense.
  const PATIENCE = 30 * 60_000

  log(`\n  Party Buzzer — reading ${questions.length} questions against ${URL}`)
  log('  you judge on the host screen: C correct, W wrong, N next. Ctrl-C to stop.\n')
  process.on('SIGINT', () => process.exit(0))

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    log(`  ── Q${i + 1}/${questions.length}${q.value !== undefined ? `  (${q.value})` : ''}`)

    if (q.value !== undefined) host.send({ t: 'host', action: { a: 'setValue', value: q.value } })
    host.send({ t: 'host', action: { a: 'arm' } })
    const armed = await host.waitFor((s) => s.round.phase === 'ARMED')
    // Let the buzzers actually open before the first word.
    await sleep(Math.max(0, armed.round.armedAt - host.now()))

    const powerAfter = Number(armed.game.options.powerAfterFragment ?? 0)
    for (let f = 0; f < q.fragments.length; f++) {
      host.send({ t: 'act', act: 'fragment', data: q.fragments[f] })
      await say(q.fragments[f])
      if (powerAfter > 0 && f + 1 === powerAfter) host.send({ t: 'act', act: 'powerEnds' })
    }

    // The host judges from here. Wrong answers re-arm for a rebound; the
    // reader waits it out — the question has all been said. Resolved means:
    // scored (award set), or passed (N with nobody left in the round).
    await host.waitFor(
      (s) =>
        s.round.phase === 'IDLE' &&
        (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0)),
      PATIENCE,
    )
    if (host.state()?.round.award) host.send({ t: 'act', act: 'revealAnswer', data: q.answer })

    // Let the payoff sit on the wall. The host's N clears it and releases us.
    await host.waitFor((s) => s.round.phase === 'IDLE' && !s.round.award, PATIENCE)
  }

  log('\n  pack finished.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
```

- [ ] **Step 2: `tools/sample-pack.txt`**

```
V: 200
This Italian composer of The Four Seasons / was a priest known as the Red Priest, / and spent much of his career at a Venice orphanage.
A: Antonio Vivaldi

The first successful English colony in America was founded in 1607 / at this Virginia site named for the king.
A: Jamestown

V: 400
This element, atomic number 26, / takes its chemical symbol from the Latin "ferrum", / and is the main component of steel.
A: Iron
```

- [ ] **Step 3: `package.json` script**

```json
    "read": "node tools/read.ts",
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

Manual smoke (needs a running server): `npm start` in one shell, then `npm run read -- tools/sample-pack.txt` in another; open `/board` and `/host`. Fragments appear as spoken, the power chip flips, judging works, the answer lands.

- [ ] **Step 5: Commit**

```bash
git add tools/read.ts tools/sample-pack.txt package.json
git commit -m "feat: the reader — spoken questions drive fragments, power, and the answer"
```

---

### Task 14: Sim `--game` flag and probe `act:` steps

**Files:**
- Modify: `tools/sim.ts`
- Modify: `tools/probe.ts`

**Interfaces:**
- Consumes: `setGame` HostAction (Task 3), `act` ClientMsg (Task 7).

- [ ] **Step 1: `tools/sim.ts` argument parsing**

Replace the arg block:

```ts
const argv = process.argv.slice(2)
// `--game quizbowl` switches the room's mode before the bots play.
const gi = argv.indexOf('--game')
const GAME = gi >= 0 ? argv[gi + 1] : process.env.GAME
const positional = argv.filter((a, i) => a !== '--game' && i !== gi + 1)
const [argRounds, argPace, argUrl] = positional
const ROUNDS = Number(argRounds ?? process.env.ROUNDS ?? Infinity)
const PACE = Number(argPace ?? process.env.PACE ?? 1)
const URL = argUrl ?? process.env.URL ?? 'http://localhost:8080'
```

In `main()`, right after `const host = await connect(URL, 'host')`:

```ts
  if (GAME) {
    host.send({ t: 'host', action: { a: 'setGame', id: GAME, options: {} } })
    await host.waitFor((s) => s.game.id === GAME)
    log(`  game mode: ${GAME}`)
  }
```

Update the header comment's usage lines with `npm run sim -- 5 1 --game quizbowl`.

- [ ] **Step 2: `tools/probe.ts` act steps**

Add to the switch, after `case 'undo':`:

```ts
        case 'act': {
          // Host-scoped acts, the reader's channel: act:fragment:Some text,
          // act:powerEnds, act:revealAnswer:The answer. Item uses go through
          // unit tests; probe's players have no inventory of their own.
          const [name, ...rest] = arg.split(':')
          host.send({ t: 'act', act: name, data: rest.join(':') || undefined })
          break
        }
```

Update the header comment's step list:

```
 *   act:name[:data]  host-scoped act (fragment / powerEnds / revealAnswer)
```

and the usage line in the no-args branch: `steps: loop join value arm buzz correct wrong next reset undo act wait clear`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

Manual smoke against a running server:

```bash
npm run probe -- act:fragment:This is the first fragment act:fragment:and the second. wait:3000 next
npm run sim -- 2 1 --game quizbowl
```

- [ ] **Step 4: Commit**

```bash
git add tools/sim.ts tools/probe.ts
git commit -m "feat: sim --game flag, probe act steps"
```

---

### Task 15: End-to-end — a quizbowl round over real sockets

**Files:**
- Create: `server/e2e.ts` (extracted `FakeClient`/`withServer`)
- Modify: `server/integration.test.ts` (import from e2e.ts)
- Test: `server/game-modes.integration.test.ts`

**Interfaces:**
- Consumes: everything server-side (Tasks 1–7).

- [ ] **Step 1: Extract the harness**

Move `FakeClient` (class, unchanged) and `withServer` (function, unchanged) plus their supporting constants (`REVEAL`, `COLLECT`, `SETTLE`) and imports from `server/integration.test.ts` into `server/e2e.ts`, exporting all three names plus the constants. Re-import them in `server/integration.test.ts`:

```ts
import { COLLECT, FakeClient, REVEAL, SETTLE, withServer } from './e2e.ts'
```

(`server/e2e.ts` is not a `.test.ts` file, so the test glob never runs it directly.)

Run: `node --test server/integration.test.ts`
Expected: PASS, unchanged behavior.

- [ ] **Step 2: Write the failing integration test**

`server/game-modes.integration.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { ARM_LEAD_MS } from './state.ts'
import { FakeClient, SETTLE, withServer } from './e2e.ts'

test('a quizbowl round: power bonus, fragments on the board but never on phones', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const board = new FakeClient(url, 'board')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await board.open()
    await amy.open('Amy')
    await amy.sync()

    host.send({
      t: 'host',
      action: {
        a: 'setGame',
        id: 'quizbowl',
        options: { powerAfterFragment: 2, powerBonus: 50, neg: 50 },
      },
    })
    await sleep(80)
    assert.equal(host.last.game.id, 'quizbowl')
    assert.equal(host.last.game.options.powerBonus, 50, 'options ride the state')
    assert.ok(host.last.games.some((g) => g.id === 'quizbowl'), 'the catalog rides too')

    host.send({ t: 'host', action: { a: 'setValue', value: 200 } })
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)

    host.send({ t: 'act', act: 'fragment', data: 'First fragment.' })
    await sleep(60)
    assert.deepEqual(board.last.round.fragments, ['First fragment.'])
    assert.equal(amy.last.round.fragments, undefined, 'phones never see the text early')

    // Amy presses during the power window; the reader's powerEnds lands after.
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await sleep(20)
    host.send({ t: 'act', act: 'powerEnds' })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')

    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[amy.playerId], 250, '200 + the 50 power bonus')
    assert.deepEqual(host.last.round.award, { name: 'Amy', points: 250 })

    host.send({ t: 'act', act: 'revealAnswer', data: 'The answer' })
    await sleep(60)
    assert.equal(board.last.round.answer, 'The answer')
    assert.equal(amy.last.round.answer, undefined)

    for (const c of [host, board, amy]) c.close()
  })
})

test('quizbowl wrong: configured neg, lockout, and an unpowered rebound', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')
    await bo.open('Bo')
    await amy.sync()
    await bo.sync()

    host.send({
      t: 'host',
      action: {
        a: 'setGame',
        id: 'quizbowl',
        options: { neg: 50, itemsEnabled: true },
      },
    })
    await sleep(60)

    host.send({ t: 'host', action: { a: 'setValue', value: 200 } })
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)

    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await sleep(20)
    host.send({ t: 'act', act: 'powerEnds' })
    await sleep(SETTLE)

    host.send({ t: 'host', action: { a: 'wrong', neg: 200 } })
    await sleep(80)
    assert.equal(host.last.scores[amy.playerId], -50, 'the module neg wins over the button')
    assert.deepEqual(host.last.round.lockedOut, [amy.playerId])
    assert.equal(host.last.round.phase, 'ARMED', 'rebound')

    // The rebound is the same question: power has ended, so Bo's buzz is not
    // powered even though it is first.
    await sleep(ARM_LEAD_MS + 20)
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(SETTLE)
    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[bo.playerId], 200, 'no power on a rebound')
    // The grant machinery ran: someone holds an item now.
    assert.equal(Object.keys(host.last.items).length, 1)

    for (const c of [host, amy, bo]) c.close()
  })
})
```

Run: `node --test server/game-modes.integration.test.ts`
Expected: FAIL before Task 1–7 code exists; PASS after. (If the earlier tasks are already in, expect PASS on the first run — that is correct, not suspicious.)

- [ ] **Step 3: Verify the whole suite**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/e2e.ts server/integration.test.ts server/game-modes.integration.test.ts
git commit -m "test: a quizbowl round end to end over real sockets"
```

---

### Task 16: Docs and final gates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: `CLAUDE.md`**

Commands block — add after the `probe` line:

```
npm run read -- pack.txt   # speak a question pack; drives fragments, power, answer
```

Architecture section — add two bullets after `server/resolve.ts`:

```
- `server/modes/` — game modules. `GameModule` hooks (scoring, power, item
  grants) are all optional; `trivia` defines none and is today's game.
  Modes are fixed per session; `setGame` switches and resets.
- `server/items.ts` — framework-level boons/sabotage (freeze, shield, steal),
  fired by players over the `act` channel and validated before they apply.
```

Add one load-bearing paragraph after "Redaction.":

```
**Modes and items live inside `State`.** `game.moduleState`, `items`, and
`effects` ride the same snapshot/undo/broadcast path as everything else —
that is why the framework adds no new persistence or timing code. Effects are
stamped with the arm they belong to and swept on the next, so nothing leaks
across questions.
```

- [ ] **Step 2: `README.md`**

Add a short "Game modes" section: the host screen folds a Game section into "Players and teams"; quizbowl-lite adds powers (driven by `npm run read -- pack.txt` speaking a question pack), negs, bouncebacks, and item drops; the pack format in four lines with a pointer to `tools/sample-pack.txt`.

- [ ] **Step 3: Final gates**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green.

Then the manual pass from the spec's toolset, against `npm start`:

```bash
npm run sim -- 3 1 --game quizbowl          # a game plays itself
npm run read -- tools/sample-pack.txt       # one spoken pack, you judge on /host
npm run probe -- clear                      # put the room back
```

Confirm: fragments assemble on the board in time with the voice; the power chip flips; a fast answer scores value + bonus; a wrong answer negs and rebounds; the winner's phone shows an item; the answer lands on the board after scoring.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: game modes, items, and the reader"
```

---

## Self-review notes (resolved while writing)

- **Spec coverage:** framework (Tasks 1–4), items (5, 7, 11), quizbowl (6), redaction (7), board/fragments (7, 8), surface registry (9), host settings (10), pack format + parser (12), reader (13), sim/probe (14), integration test (15), error handling (3, 5, 7, 12, 13). Showdown stays out, per spec.
- **`grants` wiring order:** Task 4's `correct` rewrite deliberately omits the grants line; Task 6 adds it once `executeGrants` exists. The Task 4 tests don't cover grants; Task 6's do.
- **Undo across acts:** item uses and reader acts do not push the undo stack (host misjudgements are what undo exists for; a fragment per sentence would flood the 20-deep stack). `setGame` is a host action and undoes cleanly, restoring scores.
- **Refused `setGame` and the undo stack:** the hub pushes a snapshot before `applyHostAction` even when the action is refused (same as a refused `correct` today, minus the timer guard). A no-op snapshot on the stack is harmless — undo restores identical state.
