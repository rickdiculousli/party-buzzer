# Heads-Up Duels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-player heads-up duel rounds — with host-pick, random, and nomination (vote/volunteer/back-off) selection — as a framework feature that composes with any game mode.

**Architecture:** One optional `round.candidates` field is the entire enforcement surface: the hub drops buzzes from non-candidates in the same place it already checks lockouts. A new framework module `server/duel.ts` (modeled on `server/items.ts`) owns the rule catalog, nomination pool, and resolution; host actions `openDuel`/`closeDuel`/`cancelDuel` drive it; player entry rides the existing `act` channel. The exclusive rebound falls out of `duel.missed` narrowing `candidates` on each re-arm — no new timing machinery.

**Tech Stack:** Node 26 native TypeScript server, Preact client, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-15-heads-up-duel-design.md`

## Global Constraints

- Node 26 strips types: relative imports carry `.ts` extensions; no `enum`, `namespace`, or constructor parameter properties.
- Tests use `node:test` and `node:assert/strict` only. Run one file: `node --test server/duel.test.ts`.
- No new runtime dependencies. Client is Preact; hooks must be called before any early return.
- Player-surface buttons use `onPointerDown`, never `onClick`.
- No client-side game logic: surfaces derive from `state.duel` and `round.candidates`; resolution is server-side only.
- `npm start` serves `dist/` — client changes are invisible until `npm run build`.
- Verify server changes with `npm run typecheck` and `npm test`.

---

### Task 1: Protocol types and state plumbing

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/state.ts` (`newState`, `loadState`)

**Interfaces:**
- Produces (every later task consumes these):
  - `Round.candidates?: PlayerId[]`
  - `DuelState = { rule: string; pool: DuelPoolEntry[]; seated?: [PlayerId, PlayerId]; missed: PlayerId[] }`
  - `DuelPoolEntry = { playerId: PlayerId; votes: PlayerId[]; in: boolean }`
  - `DuelRuleInfo = { id: string; name: string; entry: 'vote' | 'volunteer' | 'both' | 'none'; resolve: 'votes' | 'random' | 'host' }`
  - `State.duel?: DuelState`, `State.duelRules: DuelRuleInfo[]`
  - Host actions `{ a: 'openDuel'; rule: string }`, `{ a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }`, `{ a: 'cancelDuel' }`

- [ ] **Step 1: Add the types to `shared/protocol.ts`**

In `Round`, after `lockedOut`:

```ts
  /** The only players who may buzz this round. Set by a duel; absent = open. */
  candidates?: PlayerId[]
```

After the `GameInfo` type, add:

```ts
/** A nomination pool entry. `votes` holds voter ids, not a count — one vote per player falls out of the shape. */
export type DuelPoolEntry = {
  playerId: PlayerId
  votes: PlayerId[]
  /** Volunteered and not backed off. */
  in: boolean
}

/** A duel being set up or played. Rides State, so snapshot/undo/broadcast come free. */
export type DuelState = {
  /** Id into the duelRules catalog. */
  rule: string
  pool: DuelPoolEntry[]
  /** The two finalists, once the host closes the window (or an instant rule resolves). */
  seated?: [PlayerId, PlayerId]
  /** Finalists who answered wrong this question — drives the exclusive rebound. */
  missed: PlayerId[]
}

/** One selection rule, declared as data so the host rule picker needs no per-rule code. */
export type DuelRuleInfo = {
  id: string
  name: string
  /** How players enter the pool; 'none' = host-pick / random. */
  entry: 'vote' | 'volunteer' | 'both' | 'none'
  /** How the pool narrows to two; 'host' = the host seats explicitly. */
  resolve: 'votes' | 'random' | 'host'
}
```

In `State`, after `games`:

```ts
  /** A duel in setup or play. Absent = today's game. */
  duel?: DuelState
  /** Static rule catalog. Refreshed at startup beside `games`. */
  duelRules: DuelRuleInfo[]
```

In `HostAction`, after the `setMirror` variant:

```ts
  | { a: 'openDuel'; rule: string }
  /** ids = host override (and the only path for resolve:'host' rules); absent = resolve by rule. */
  | { a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }
  | { a: 'cancelDuel' }
```

- [ ] **Step 2: Plumb `newState` and `loadState` in `server/state.ts`**

In `newState()`, after `games: []`:

```ts
    duelRules: [],
```

In `loadState()`, beside the other boot tolerances (after `loaded.effects ??= []`):

```ts
    loaded.duelRules ??= []
    // A duel mid-setup can't survive a restart: the pool was voted under a
    // room that may not be back. Fresh boot, no duel.
    delete loaded.duel
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS (newState literal now satisfies the extended `State`).

- [ ] **Step 4: Commit**

```bash
git add shared/protocol.ts server/state.ts
git commit -m "feat: duel protocol types — candidates, DuelState, rule catalog, host actions"
```

---

### Task 2: `server/duel.ts` — catalog and resolution

**Files:**
- Create: `server/duel.ts`
- Test: `server/duel.test.ts`

**Interfaces:**
- Consumes: Task 1's protocol types; `applyHostAction`/`newState` from `server/state.ts`.
- Produces:
  - `DUEL_RULES: DuelRuleInfo[]` and `duelRule(id: string): DuelRuleInfo | undefined`
  - `duelCatalog(): DuelRuleInfo[]`
  - `eligible(state: State): PlayerId[]` — connected players; in teams mode, teamed players only
  - `resolveDuel(state: State, duel: DuelState): [PlayerId, PlayerId] | null`
  - (Task 3 adds `duelAct` and `seatDuel`; Task 4 adds `duelOnArm`/`duelOnWrong`.)

- [ ] **Step 1: Write the failing tests**

Create `server/duel.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { newState } from './state.ts'
import { resolveDuel } from './duel.ts'
import type { Mode, PlayerId, State } from '../shared/protocol.ts'

/** A state with named players; the optional second tuple element is a team id. */
export function stateWith(players: [PlayerId, string?][], mode: Mode = 'solo'): State {
  const state = newState()
  state.mode = mode
  const teamIds = [...new Set(players.map(([, t]) => t).filter((t) => !!t))]
  state.teams = teamIds.map((id) => ({ id, name: id, color: 'var(--id-1)' }))
  state.players = players.map(([id, teamId]) => ({ id, name: id, teamId, connected: true }))
  return state
}

/** A duel in mid-setup, without going through the host action (Task 4's subject). */
export function openDuel(state: State, rule: string): void {
  state.duel = { rule, pool: [], missed: [] }
}

test('vote resolution seats the top two, pool order breaking ties', () => {
  const state = stateWith([['a'], ['b'], ['c'], ['d']])
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'a', votes: ['c', 'd'], in: false },
    { playerId: 'b', votes: ['a'], in: false },
    { playerId: 'c', votes: ['b'], in: false },
  )
  // a leads on 2; b and c tie on 1 and b entered the pool first.
  assert.deepEqual(resolveDuel(state, duel), ['a', 'b'])
})

test('vote resolution skips the unteamed in teams mode', () => {
  const state = stateWith([['a', 'ta'], ['b', 'tb'], ['c'], ['d', 'ta']], 'teams')
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'c', votes: ['a', 'b'], in: false }, // most votes, but no team
    { playerId: 'a', votes: ['c'], in: false },
    { playerId: 'b', votes: ['d'], in: false },
  )
  assert.deepEqual(resolveDuel(state, duel), ['a', 'b'])
})

test('teams mode never seats two finalists from one team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'a', votes: ['c'], in: false },
    { playerId: 'b', votes: ['a'], in: false }, // same team as a — skipped
    { playerId: 'c', votes: ['b'], in: false },
  )
  assert.deepEqual(resolveDuel(state, duel), ['a', 'c'])
})

test('a thin pool resolves to nothing', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  state.duel!.pool.push({ playerId: 'a', votes: ['b'], in: false })
  assert.equal(resolveDuel(state, state.duel!), null)
})

test('host-resolve rules never auto-seat', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'host-pick')
  assert.equal(resolveDuel(state, state.duel!), null)
})

test('volunteer-random draws only from the in pool', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'volunteer-random')
  state.duel!.pool.push(
    { playerId: 'a', votes: [], in: true },
    { playerId: 'b', votes: [], in: true },
    { playerId: 'c', votes: [], in: false }, // backed off
  )
  const pair = resolveDuel(state, state.duel!)
  assert.deepEqual(pair?.slice().sort(), ['a', 'b'])
})

test('a disconnected pool member cannot be seated', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  state.players.find((p) => p.id === 'c')!.connected = false
  openDuel(state, 'vote')
  state.duel!.pool.push(
    { playerId: 'c', votes: ['a', 'b'], in: false },
    { playerId: 'a', votes: ['c'], in: false },
  )
  assert.equal(resolveDuel(state, state.duel!), null, 'only one seatable candidate')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/duel.test.ts`
Expected: FAIL — `Cannot find module './duel.ts'`.

- [ ] **Step 3: Write `server/duel.ts`**

```ts
/**
 * Heads-up duels. Framework-level, like items: modes never learn duels exist,
 * and duels never learn which mode is scoring. Selection rules are data — a
 * future rule is a row in DUEL_RULES, not code — and the catalog rides State
 * so the host's rule picker renders itself.
 *
 * Player entry (volunteer / back off / vote) rides the `act` channel through
 * duelAct; seating rides host actions in state.ts. The hub enforces the
 * result with one check on round.candidates at the buzz gate.
 */
import type {
  DuelPoolEntry, DuelRuleInfo, DuelState, PlayerId, State,
} from '../shared/protocol.ts'

export const DUEL_RULES: DuelRuleInfo[] = [
  { id: 'host-pick', name: 'Host picks two', entry: 'none', resolve: 'host' },
  { id: 'random', name: 'Random draw', entry: 'none', resolve: 'random' },
  { id: 'vote', name: 'Room votes — most voted go', entry: 'vote', resolve: 'votes' },
  { id: 'volunteer-random', name: 'Volunteers, random draw', entry: 'volunteer', resolve: 'random' },
  { id: 'volunteer-backoff', name: 'Volunteers, back off to two', entry: 'volunteer', resolve: 'host' },
]

export function duelRule(id: string): DuelRuleInfo | undefined {
  return DUEL_RULES.find((r) => r.id === id)
}

/** The static catalog the host's rule picker is rendered from. */
export function duelCatalog(): DuelRuleInfo[] {
  return DUEL_RULES
}

/** Who may be seated: connected, and in teams mode holding a team. */
export function eligible(state: State): PlayerId[] {
  return state.players
    .filter((p) => p.connected)
    .filter((p) => state.mode !== 'teams' || !!p.teamId)
    .map((p) => p.id)
}

function teamOf(state: State, playerId: PlayerId): string | undefined {
  return state.players.find((p) => p.id === playerId)?.teamId
}

/**
 * Seat two from a ranked list. In teams mode the second seat comes from a
 * different team than the first — a duel inside one team scores for both
 * sides at once, which is no duel.
 */
function twoSeats(state: State, ranked: PlayerId[]): [PlayerId, PlayerId] | null {
  const first = ranked[0]
  if (!first) return null
  if (state.mode !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(state, id) !== teamOf(state, first))
  return second ? [first, second] : null
}

/**
 * The two finalists per the duel's rule, or null when the pool cannot fill
 * the seats (or the rule leaves seating to the host). Null is not an error:
 * the window stays open and the host overrides or cancels.
 */
export function resolveDuel(state: State, duel: DuelState): [PlayerId, PlayerId] | null {
  const rule = duelRule(duel.rule)
  if (!rule || rule.resolve === 'host') return null
  const ok = new Set(eligible(state))
  if (rule.resolve === 'votes') {
    // ponytail: ties break by pool position — who received their FIRST vote
    // first, not who reached the tying count first. The faithful version
    // needs a timestamp beside each voter id; add one if ties feel wrong.
    const ranked = duel.pool
      .filter((e) => e.votes.length > 0 && ok.has(e.playerId))
      .sort((a, b) => b.votes.length - a.votes.length)
      .map((e) => e.playerId)
    return twoSeats(state, ranked)
  }
  // random: entry 'none' draws from everyone eligible; volunteer rules draw
  // from whoever is still in.
  const source =
    rule.entry === 'none'
      ? [...ok]
      : duel.pool.filter((e) => e.in && ok.has(e.playerId)).map((e) => e.playerId)
  for (let i = source.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[source[i], source[j]] = [source[j], source[i]]
  }
  return twoSeats(state, source)
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/duel.test.ts && npm run typecheck`
Expected: 7 PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/duel.ts server/duel.test.ts
git commit -m "feat: duel rule catalog and resolution — votes, random, one per team"
```

---

### Task 3: `duelAct` and `seatDuel` — player entry and host override

**Files:**
- Modify: `server/duel.ts`
- Test: `server/duel.test.ts`

**Interfaces:**
- Consumes: Task 2's `duelRule`, `eligible`, `teamOf`.
- Produces:
  - `duelAct(state: State, playerId: PlayerId, act: string, data: unknown): boolean` — handles `'duelVolunteer' | 'duelBackOff' | 'duelVote'` (data = target id string for votes); false = dropped, nothing mutated
  - `seatDuel(state: State, ids: [PlayerId, PlayerId]): boolean` — validates and seats an explicit pair

- [ ] **Step 1: Write the failing tests**

Append to `server/duel.test.ts` (add `duelAct, seatDuel` to the duel.ts import, and use Task 2's `openDuel` helper):

```ts
test('gates: acts that do not match the rule are dropped', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'vote')
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false, 'no volunteering under a vote rule')
  assert.equal(duelAct(state, 'a', 'duelBackOff'), false)
  assert.equal(state.duel!.pool.length, 0)
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), true)
  assert.equal(state.duel!.pool.length, 1)
})

test('a self-vote or a vote for a ghost is dropped', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'vote')
  assert.equal(duelAct(state, 'a', 'duelVote', 'a'), false)
  assert.equal(duelAct(state, 'a', 'duelVote', 'ghost'), false)
  state.players.find((p) => p.id === 'b')!.connected = false
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), false, 'disconnected target')
  assert.equal(state.duel!.pool.length, 0)
})

test('re-voting moves the vote; one player never counts twice', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  duelAct(state, 'a', 'duelVote', 'b')
  duelAct(state, 'a', 'duelVote', 'c')
  assert.deepEqual(state.duel!.pool.find((e) => e.playerId === 'b')!.votes, [])
  assert.deepEqual(state.duel!.pool.find((e) => e.playerId === 'c')!.votes, ['a'])
})

test('volunteer and back-off under a volunteer rule', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'volunteer-backoff')
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), false, 'no voting here')
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), true)
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false, 'already in')
  assert.equal(duelAct(state, 'a', 'duelBackOff'), true)
  assert.equal(state.duel!.pool[0].in, false)
  assert.equal(duelAct(state, 'a', 'duelBackOff'), false, 'already out')
})

test('entry stops once the duel is seated', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'host-pick')
  assert.ok(seatDuel(state, ['a', 'b']))
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false)
})

test('seatDuel validates: distinct, eligible, one per team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  openDuel(state, 'host-pick')
  assert.equal(seatDuel(state, ['a', 'a']), false)
  assert.equal(seatDuel(state, ['a', 'ghost']), false)
  assert.equal(seatDuel(state, ['a', 'b']), false, 'same team')
  assert.equal(seatDuel(state, ['a', 'c']), true)
  assert.deepEqual(state.duel!.seated, ['a', 'c'])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/duel.test.ts`
Expected: FAIL — `duelAct is not a function` / `seatDuel is not exported`.

- [ ] **Step 3: Implement**

Append to `server/duel.ts`:

```ts
/**
 * A player's duel act. Every path validates against the rule's gates before
 * touching the pool; false means dropped and nothing mutated.
 */
export function duelAct(
  state: State,
  playerId: PlayerId,
  act: string,
  data: unknown,
): boolean {
  const duel = state.duel
  if (!duel || duel.seated) return false
  const rule = duelRule(duel.rule)
  if (!rule) return false
  const takesVotes = rule.entry === 'vote' || rule.entry === 'both'
  const takesVolunteers = rule.entry === 'volunteer' || rule.entry === 'both'
  const mine = duel.pool.find((e) => e.playerId === playerId)

  if (act === 'duelVolunteer') {
    if (!takesVolunteers || mine?.in) return false
    if (mine) mine.in = true
    else duel.pool.push({ playerId, votes: [], in: true })
    return true
  }

  if (act === 'duelBackOff') {
    if (!takesVolunteers || !mine?.in) return false
    mine.in = false
    return true
  }

  if (act === 'duelVote') {
    if (!takesVotes || typeof data !== 'string') return false
    if (data === playerId) return false // a vote is for someone else
    if (!state.players.some((p) => p.id === data && p.connected)) return false
    // One vote per player: lift it off whoever held it, then place it.
    for (const e of duel.pool) {
      const at = e.votes.indexOf(playerId)
      if (at >= 0) e.votes.splice(at, 1)
    }
    const target = duel.pool.find((e) => e.playerId === data)
    if (target) target.votes.push(playerId)
    else duel.pool.push({ playerId: data, votes: [playerId], in: false })
    return true
  }

  return false
}

/**
 * Seat an explicit pair (host override, and the only path for resolve:'host'
 * rules). The gates constrain entry; this constrains the result.
 */
export function seatDuel(state: State, ids: [PlayerId, PlayerId]): boolean {
  const duel = state.duel
  if (!duel || duel.seated) return false
  const [a, b] = ids
  if (!a || !b || a === b) return false
  const ok = new Set(eligible(state))
  if (!ok.has(a) || !ok.has(b)) return false
  if (state.mode === 'teams' && teamOf(state, a) === teamOf(state, b)) return false
  duel.seated = [a, b]
  return true
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/duel.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/duel.ts server/duel.test.ts
git commit -m "feat: duel entry acts and validated host override seating"
```

---

### Task 4: Host actions and the round lifecycle in `state.ts`

**Files:**
- Modify: `server/state.ts` (`applyHostAction`)
- Test: `server/duel.test.ts`

**Interfaces:**
- Consumes: `duelRule`, `resolveDuel`, `seatDuel` from Task 2/3; new `duelOnArm`, `duelOnWrong` defined here in `duel.ts`.
- Produces (Task 5 and the clients rely on this behavior):
  - `openDuel` — IDLE only, known rule only; `resolve:'random'` seats instantly or refuses
  - `closeDuel` — IDLE only; explicit ids → `seatDuel`, else `resolveDuel`; failure leaves the window open
  - `cancelDuel` — any time; also lifts `round.candidates`
  - `arm` stamps `round.candidates` from `seated − missed`; `wrong` narrows it; `next`/`resetRound` clear the duel; `setGame`/`setMode` cancel an unseated duel

- [ ] **Step 1: Write the failing tests**

Append to `server/duel.test.ts` (change the state.ts import to `import { applyHostAction, newState } from './state.ts'`):

```ts
test('openDuel is refused mid-round and for unknown rules', () => {
  const state = stateWith([['a'], ['b']])
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  assert.equal(state.duel, undefined)
  state.round.phase = 'IDLE'
  applyHostAction(state, { a: 'openDuel', rule: 'bogus' })
  assert.equal(state.duel, undefined)
})

test('random seats instantly; one team total cannot fill two seats', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'random' })
  const seated = state.duel?.seated
  assert.ok(seated)
  assert.notEqual(seated[0], seated[1])

  const teamed = stateWith([['a', 'ta'], ['b', 'ta']], 'teams')
  applyHostAction(teamed, { a: 'openDuel', rule: 'random' })
  assert.equal(teamed.duel, undefined, 'refused: nothing to close later')
})

test('random in teams mode draws one per team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  applyHostAction(state, { a: 'openDuel', rule: 'random' })
  const [x, y] = state.duel!.seated!
  const teamOf = (id: string) => state.players.find((p) => p.id === id)?.teamId
  assert.notEqual(teamOf(x), teamOf(y))
})

test('closeDuel with a thin pool stays open', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  state.duel!.pool.push({ playerId: 'a', votes: ['b'], in: false })
  applyHostAction(state, { a: 'closeDuel' })
  assert.equal(state.duel!.seated, undefined, 'still collecting')
})

test('closeDuel is refused once the question is live', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  assert.equal(state.duel!.seated, undefined)
})

test('arm stamps the seated pair; next clears the duel', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(state.round.candidates, ['a', 'b'])
  applyHostAction(state, { a: 'next' })
  assert.equal(state.duel, undefined)
  assert.equal(state.round.candidates, undefined)
})

test('a wrong answer narrows the rebound to the other finalist; a fresh arm resets', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  state.round.order = [{ playerId: 'a', name: 'a', at: 1, deltaMs: 0 }]
  state.round.phase = 'LOCKED'
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.duel!.missed, ['a'])
  assert.deepEqual(state.round.candidates, ['b'], 'exclusive rebound')

  state.round.order = [{ playerId: 'b', name: 'b', at: 2, deltaMs: 0 }]
  state.round.phase = 'LOCKED'
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.round.candidates, [], 'both missed — the round is dead')

  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(state.duel!.missed, [])
  assert.deepEqual(state.round.candidates, ['a', 'b'], 'rematch: same pair, fresh question')
})

test('setGame cancels an unseated duel; a seated one survives', () => {
  const state = stateWith([['a'], ['b']])
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.equal(state.duel, undefined)

  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.ok(state.duel?.seated, 'a seated pair is a commitment, not setup')
})

test('cancelDuel lifts the candidacy mid-round', () => {
  const state = stateWith([['a'], ['b']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'cancelDuel' })
  assert.equal(state.duel, undefined)
  assert.equal(state.round.candidates, undefined, 'the floor reopens')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/duel.test.ts`
Expected: FAIL — `openDuel` etc. fall through `applyHostAction`'s switch silently, so `state.duel` stays undefined.

- [ ] **Step 3: Implement**

In `server/state.ts`, add to the duel import block at top:

```ts
import { duelOnArm, duelOnWrong, duelRule, resolveDuel, seatDuel } from './duel.ts'
```

In `applyHostAction`, `case 'arm'`: after `delete round.answer` add `delete round.candidates`, and after the `onArm` call add `duelOnArm(state)`:

```ts
      delete round.award
      delete round.fragments
      delete round.answer
      delete round.candidates
```

```ts
      moduleFor(state.game.id).onArm?.(state)
      duelOnArm(state)
      return
```

In `case 'wrong'`, just before the final `return`:

```ts
      duelOnWrong(state, leader.playerId)
      return
```

In `case 'next' / 'resetRound'`, add alongside the other clears:

```ts
      delete round.candidates
      // A duel is one question. The host re-opens (or rematches by arming
      // before next) rather than the pair leaking into the next round.
      delete state.duel
```

In `case 'setGame'`, directly after the `round.phase !== 'IDLE'` guard:

```ts
      // A pool was built under the old game's room; a seated pair is a
      // commitment and survives.
      if (state.duel && !state.duel.seated) delete state.duel
```

In `case 'setMode'`:

```ts
    case 'setMode':
      state.mode = action.mode
      // Teams constraints shape the pool; re-open under the new mode.
      if (state.duel && !state.duel.seated) delete state.duel
      return
```

Add the three new cases before the closing brace of the switch:

```ts
    case 'openDuel': {
      // Seating happens before the question opens so candidates stamp at arm.
      if (round.phase !== 'IDLE') return
      const rule = duelRule(action.rule)
      if (!rule) return
      state.duel = { rule: rule.id, pool: [], missed: [] }
      // Instant rules seat now; entry rules wait for the host to close.
      if (rule.resolve === 'random') {
        const pair = resolveDuel(state, state.duel)
        if (pair) state.duel.seated = pair
        else delete state.duel // fewer than two eligible — nothing to close
      }
      return
    }

    case 'closeDuel': {
      const duel = state.duel
      if (!duel || duel.seated) return
      if (round.phase !== 'IDLE') return
      if (action.playerIds) {
        seatDuel(state, action.playerIds)
        return
      }
      const pair = resolveDuel(state, duel)
      if (pair) duel.seated = pair
      return
    }

    case 'cancelDuel':
      delete state.duel
      // Mid-round cancel reopens the floor for the question in flight.
      delete round.candidates
      return
```

Append to `server/duel.ts`:

```ts
/**
 * Fresh-question stamp. Called from the `arm` host action only — a `wrong`
 * rebound re-arms without passing through it, which is what keeps `missed`
 * alive across the rebound.
 */
export function duelOnArm(state: State): void {
  const duel = state.duel
  if (!duel?.seated) return
  duel.missed = []
  state.round.candidates = [...duel.seated]
}

/** The exclusive rebound: the leader is out, the other finalist stands alone. */
export function duelOnWrong(state: State, leaderId: PlayerId): void {
  const duel = state.duel
  if (!duel?.seated) return
  if (!duel.missed.includes(leaderId)) duel.missed.push(leaderId)
  state.round.candidates = duel.seated.filter((id) => !duel.missed.includes(id))
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/duel.test.ts && npm test && npm run typecheck`
Expected: all PASS — including the existing suite, confirming no regression in arm/wrong/next.

- [ ] **Step 5: Commit**

```bash
git add server/state.ts server/duel.ts server/duel.test.ts
git commit -m "feat: duel host actions and round lifecycle — stamp, rebound, clear"
```

---

### Task 5: The hub — catalog refresh, buzz gate, act dispatch

**Files:**
- Modify: `server/hub.ts`
- Test: `server/hub.test.ts`

**Interfaces:**
- Consumes: `duelCatalog`, `duelAct` from `server/duel.ts`; `round.candidates` from Task 1.
- Produces: the enforcement point all clients rely on — a buzz from a non-candidate is dropped before it opens the window; `duelVolunteer`/`duelBackOff`/`duelVote` accepted from player connections; `state.duelRules` populated at boot.

- [ ] **Step 1: Write the failing tests**

Append to `server/hub.test.ts`:

```ts
test('a duel narrows the window to its finalists', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  const c = conn('player')
  joinAs(hub, a, 'A')
  joinAs(hub, b, 'B')
  joinAs(hub, c, 'C')
  state.round.candidates = [a.playerId!, b.playerId!]
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  hub.handle(c, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'a spectator never opens the window')
  hub.handle(a, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'COLLECTING', 'a finalist buzzes through')
})

test('duel acts ride the act channel from players only', () => {
  const { state, hub, conn } = rig()
  const host = conn('host')
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  state.duel = { rule: 'volunteer-random', pool: [], missed: [] }
  hub.handle(host, { t: 'act', act: 'duelVolunteer' })
  assert.equal(state.duel.pool.length, 0, 'no playerId, no entry')
  hub.handle(phone, { t: 'act', act: 'duelVolunteer' })
  assert.equal(state.duel.pool.length, 1)
  assert.equal(state.duel.pool[0].playerId, phone.playerId)
})

test('the duel pool is visible in player views', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  state.duel = {
    rule: 'vote',
    pool: [{ playerId: 'b', votes: ['a'], in: false }],
    missed: [],
  }
  assert.equal(hub.viewFor(phone).duel?.pool.length, 1, 'the room sees the pool')
  assert.equal(hub.viewFor(conn('host')).duel?.pool.length, 1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test server/hub.test.ts`
Expected: FAIL — the spectator's buzz opens the window (`'COLLECTING'`).

- [ ] **Step 3: Implement**

In `server/hub.ts`, extend the items import line area with:

```ts
import { duelAct, duelCatalog } from './duel.ts'
```

In the constructor, beside the games refresh:

```ts
    this.state.games = catalog()
    // Same reasoning as the games catalog: a snapshot's copy may be stale.
    this.state.duelRules = duelCatalog()
```

In `buzz()`, directly before the `buzzBlockReason` check:

```ts
    // A duel narrows the field to its finalists for this arm.
    if (round.candidates && !round.candidates.includes(conn.playerId)) return
```

In `act()`, directly after the `useItem` block:

```ts
    // Duel entry belongs to players, like items.
    if (name.startsWith('duel')) {
      if (!conn.playerId) return
      if (duelAct(this.state, conn.playerId, name, data)) this.changed()
      return
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test server/hub.test.ts && npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/hub.ts server/hub.test.ts
git commit -m "feat: the hub gates buzzes on round.candidates and dispatches duel acts"
```

---

### Task 6: Integration — a full duel over real sockets

**Files:**
- Create: `server/duel.integration.test.ts`

**Interfaces:**
- Consumes: `FakeClient, SETTLE, withServer` from `server/e2e.ts`; the full Task 1–5 surface.

- [ ] **Step 1: Write the test**

Create `server/duel.integration.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { ARM_LEAD_MS } from './state.ts'
import { FakeClient, SETTLE, withServer } from './e2e.ts'

test('a duel: vote, seat, finalists only, exclusive rebound', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const ada = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    const cy = new FakeClient(url, 'player')
    await host.open()
    await ada.open('Ada')
    await bo.open('Bo')
    await cy.open('Cy')
    await bo.sync()

    host.send({ t: 'host', action: { a: 'openDuel', rule: 'vote' } })
    await sleep(60)
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    cy.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    bo.send({ t: 'act', act: 'duelVote', data: ada.playerId })
    await sleep(60)
    // The pool is room theater: phones see it too.
    const poolOnPhone = ada.last.duel?.pool ?? []
    assert.equal(poolOnPhone.find((e) => e.playerId === bo.playerId)?.votes.length, 2)

    host.send({ t: 'host', action: { a: 'closeDuel' } })
    await sleep(60)
    assert.deepEqual(host.last.duel?.seated, [bo.playerId, ada.playerId])

    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)
    assert.deepEqual(host.last.round.candidates, [bo.playerId, ada.playerId])

    // Cy is not in this round: the buzz is dropped, the window never opens.
    cy.send({ t: 'buzz', at: performance.now() })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'ARMED')

    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')
    host.send({ t: 'host', action: { a: 'wrong', neg: 0 } })
    await sleep(60)
    assert.deepEqual(host.last.round.candidates, [ada.playerId], 'the rebound is Ada’s alone')

    // Bo’s thumb is dead now; Ada’s is not.
    await sleep(ARM_LEAD_MS)
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(30)
    await ada.sync()
    ada.send({ t: 'buzz', at: performance.now() + ada.offset })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')
    assert.equal(host.last.round.order[0]?.playerId, ada.playerId)

    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[ada.playerId], host.last.round.value)

    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    assert.equal(host.last.duel, undefined, 'the duel was one question')

    for (const c of [host, ada, bo, cy]) c.close()
  })
})
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test server/duel.integration.test.ts`
Expected: PASS. If a timing assertion flakes, widen the sleeps — do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
git add server/duel.integration.test.ts
git commit -m "test: a full duel over real sockets — vote, seat, rebound"
```

---

### Task 7: Host surface — `client/DuelPanel.tsx`

**Files:**
- Create: `client/DuelPanel.tsx`
- Modify: `client/Host.tsx`

**Interfaces:**
- Consumes: `state.duelRules`, `state.duel`, host actions from Task 1.
- Produces: `DuelPanel({ state, act }: { state: State; act: (a: HostAction) => void })` — the only duel UI the host needs.

- [ ] **Step 1: Create `client/DuelPanel.tsx`**

```tsx
import { useState } from 'preact/hooks'
import type { HostAction, PlayerId, State } from '../shared/protocol.ts'

/**
 * Heads-up duels: open a window (or seat instantly), watch the pool, close it
 * into two finalists. Everything here is a projection of state.duel — the
 * resolution itself is server-side (server/duel.ts). The pool below is sorted
 * for display only; ties and the teams-mode one-per-team rule are settled by
 * the server when the window closes.
 */
export function DuelPanel({ state, act }: { state: State; act: (a: HostAction) => void }) {
  const [pick, setPick] = useState<PlayerId[]>([])
  const duel = state.duel
  const idle = state.round.phase === 'IDLE'
  const name = (id: PlayerId) => state.players.find((p) => p.id === id)?.name ?? '?'
  const eligible = state.players.filter(
    (p) => p.connected && (state.mode !== 'teams' || !!p.teamId),
  )

  if (!duel) {
    return (
      <section>
        <p class="eyebrow">Heads-up</p>
        <div class="host__minor">
          {state.duelRules.map((r) => (
            <button
              key={r.id}
              class="btn"
              disabled={!idle || eligible.length < 2}
              onClick={() => act({ a: 'openDuel', rule: r.id })}
            >
              {r.name}
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (duel.seated) {
    return (
      <section>
        <p class="eyebrow">Heads-up</p>
        <p>
          {name(duel.seated[0])} <span class="muted">vs</span> {name(duel.seated[1])}
        </p>
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel duel
        </button>
      </section>
    )
  }

  const rule = state.duelRules.find((r) => r.id === duel.rule)
  const toggle = (id: PlayerId) =>
    setPick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)))

  const pool = duel.pool.slice().sort((a, b) => b.votes.length - a.votes.length)

  return (
    <section>
      <p class="eyebrow">Heads-up — {rule?.name ?? duel.rule}</p>

      {rule && rule.entry !== 'none' &&
        (pool.length === 0 ? (
          <p class="muted">Waiting for the room…</p>
        ) : (
          <ol class="host__order">
            {pool.map((e) => (
              <li key={e.playerId} class="row">
                <span class="row__label">{name(e.playerId)}</span>
                <span class="readout readout--ms">
                  {[
                    e.votes.length > 0 && `${e.votes.length} vote${e.votes.length === 1 ? '' : 's'}`,
                    e.in && 'in',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        ))}

      <div class="host__minor" style={{ marginTop: 'var(--s2)' }}>
        {rule?.resolve !== 'host' && (
          <button class="btn btn--primary" onClick={() => act({ a: 'closeDuel' })}>
            Seat them
          </button>
        )}
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel
        </button>
      </div>

      <p class="eyebrow" style={{ marginTop: 'var(--s3)' }}>Or pick two</p>
      <div class="host__minor">
        {eligible.map((p) => (
          <button
            key={p.id}
            class={pick.includes(p.id) ? 'btn btn--primary' : 'btn'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button
          class="btn btn--go"
          disabled={pick.length !== 2}
          onClick={() => {
            act({ a: 'closeDuel', playerIds: [pick[0], pick[1]] })
            setPick([])
          }}
        >
          Seat these two
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Mount it in `client/Host.tsx`**

Add the import:

```ts
import { DuelPanel } from './DuelPanel.tsx'
```

Render it as its own section between the buzz-order `</section>` and the scores `<section>`:

```tsx
      <DuelPanel state={state} act={act} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean. (Manual check via `npm start` + `npm run fakes -- add 4`: open a vote duel, vote from a phone, close it.)

- [ ] **Step 4: Commit**

```bash
git add client/DuelPanel.tsx client/Host.tsx
git commit -m "feat: host duel panel — rule picker, live pool, seat or override"
```

---

### Task 8: Player surface — nomination card and spectator state

**Files:**
- Modify: `client/Player.tsx`

**Interfaces:**
- Consumes: `state.duel`, `state.duelRules`, `round.candidates`; sends `duelVolunteer`/`duelBackOff`/`duelVote` over the `act` channel.

- [ ] **Step 1: Add the derivations**

In `Player()`, with the other derived state above the `useOpen` call (after the `opponents` line is a good spot):

```ts
  const duel = state?.duel
  const duelRule = state?.duelRules.find((r) => r.id === duel?.rule)
  const myDuelEntry = duel?.pool.find((e) => e.playerId === playerId)
  const myVoteFor = duel?.pool.find((e) => e.votes.includes(playerId ?? ''))?.playerId
  const inCount = duel?.pool.filter((e) => e.in).length ?? 0
  const finalist = !!playerId && !!round?.candidates?.includes(playerId)
  const spectator = !!round?.candidates && !finalist && !!playerId
  const finalistNames = round?.candidates?.map(
    (id) => state?.players.find((p) => p.id === id)?.name ?? '?',
  )
```

In the `useOpen` callback guard, add spectator:

```ts
    if (barred || frozen || spectator) return
```

In the label chain, insert a branch after the `barred` branch:

```ts
  } else if (spectator) {
    label = 'Duel'
    sub = `${finalistNames?.join(' vs ')} — you sit this one out`
    mood = 'is-barred'
  }
```

Add `spectator` to the buzzer's disabled list and to the `buzz()` guard:

```ts
    if (!open || barred || pressed || frozen || spectator) return
```

```tsx
        disabled={!open || barred || pressed || frozen || spectator}
```

- [ ] **Step 2: Add the nomination card**

In the JSX, directly after the `player__lead-in` div (before the buzzer button):

```tsx
      {duel && !duel.seated && duelRule && (
        <div class="player__duel">
          <p class="eyebrow">Heads-up — who plays?</p>
          {(duelRule.entry === 'volunteer' || duelRule.entry === 'both') && (
            <>
              <button
                class={myDuelEntry?.in ? 'btn btn--primary' : 'btn'}
                onPointerDown={() =>
                  send({ t: 'act', act: myDuelEntry?.in ? 'duelBackOff' : 'duelVolunteer' })
                }
              >
                {myDuelEntry?.in ? 'Back off' : 'I’m in'}
              </button>
              <p class="muted">
                {inCount} in{inCount > 2 ? ' — someone has to back off' : ''}
              </p>
            </>
          )}
          {(duelRule.entry === 'vote' || duelRule.entry === 'both') && (
            <div class="player__items">
              {opponents.map((p) => {
                const votes = duel.pool.find((e) => e.playerId === p.id)?.votes.length ?? 0
                return (
                  <button
                    key={p.id}
                    class={myVoteFor === p.id ? 'btn btn--primary' : 'btn'}
                    onPointerDown={() => send({ t: 'act', act: 'duelVote', data: p.id })}
                  >
                    {p.name}
                    {votes > 0 ? ` · ${votes}` : ''}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean. Manual check: a finalist's phone buzzes normally; a spectator's shows "Duel — Ada vs Bo".

- [ ] **Step 4: Commit**

```bash
git add client/Player.tsx
git commit -m "feat: player nomination card and the duel spectator state"
```

---

### Task 9: Board surface — pool theater and the face-off frame

**Files:**
- Modify: `client/Board.tsx`
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `state.duel`, `round.candidates`. Presentation only.

- [ ] **Step 1: Extend the middle band in `client/Board.tsx`**

In `Board()`, beside the other derivations after the `if (!state)` guard:

```ts
  const finalistNames = round.candidates?.map(
    (id) => state.players.find((p) => p.id === id)?.name ?? '?',
  )
```

Replace the middle band's ternary chain so nominations and the face-off slot in ahead of the "Ready/Buzz" call. The chain becomes:

```tsx
        <div class={leader ? 'board__mid' : 'board__mid board__mid--cue'}>
          {leader ? (
            <p class="board__hero">{leader.name}</p>
          ) : state.duel && !state.duel.seated ? (
            <>
              <p class="board__idle">Heads-up — nominations open</p>
              {state.duel.pool.length > 0 && (
                <p class="board__noms">
                  {state.duel.pool
                    .map((e) => {
                      const n = state.players.find((p) => p.id === e.playerId)?.name ?? '?'
                      const tags = [
                        e.votes.length > 0 && `${e.votes.length} ✓`,
                        e.in && 'in',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return tags ? `${n} ${tags}` : n
                    })
                    .join(' · ')}
                </p>
              )}
            </>
          ) : round.fragments?.length ? (
            <p class="board__question">{round.fragments.join(' ')}</p>
          ) : finalistNames?.length === 2 ? (
            // The face-off yields the stage to the question text while the
            // reader is speaking, and to the leader the moment someone buzzes.
            <p class="board__faceoff">
              <span class="board__hero">{finalistNames[0]}</span>
              <span class="board__idle">vs</span>
              <span class="board__hero">{finalistNames[1]}</span>
            </p>
          ) : (
            <p class={open ? 'board__call' : 'board__idle'}>
              {open ? 'Buzz' : armed ? 'Stand by' : 'Ready'}
            </p>
          )}
        </div>
```

- [ ] **Step 2: Add the two CSS rules in `client/style.css`**

Near the other `board__` rules:

```css
/* The face-off frame and the nomination pool: one line each, room-scale. */
.board__faceoff {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--s3);
}

.board__noms {
  font-size: var(--fs-2);
  color: var(--ink-dim);
  text-align: center;
}
```

Check the token names against `client/tokens.css` first — if `--fs-2` or `--ink-dim` don't exist, use the nearest size/ink tokens that do (the file is the source of truth for names).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: clean. For the frame itself, `npm run motion` scenarios are the tuning path if the layout needs it — not required for this task.

- [ ] **Step 4: Commit**

```bash
git add client/Board.tsx client/style.css
git commit -m "feat: board shows the nomination pool and the face-off frame"
```

---

### Task 10: Docs and full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the seam**

In `CLAUDE.md`'s architecture list, after the `server/items.ts` bullet:

```markdown
- `server/duel.ts` — heads-up duels (two-player face-offs). Framework-level,
  composes with any mode: selection rules are data in a catalog, entry rides
  the `act` channel, and enforcement is one `round.candidates` check at the
  hub's buzz gate. A wrong answer narrows candidates to the other finalist,
  which is the whole rebound mechanic.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean.

Then a live smoke: `npm start`, `npm run fakes -- add 4`, walk `docs/manual-checklist.md`-style — open a vote duel from `/host`, vote from a phone, close, arm, confirm only finalists buzz and the rebound is exclusive. `npm run fakes -- remove` after.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: duel.ts in the architecture list"
```

---

## Self-Review Notes

- Spec coverage: protocol shape (Task 1), catalog/resolution (2), gates (3), lifecycle incl. rebound and one-per-team (4), buzz gate + act channel + pool visibility (5), integration (6), host/player/board surfaces (7–9). The spec's "no timer, host closes" is enforced by the absence of any timer code; "pool visible to players" is tested in Tasks 5 and 6.
- Known behavior, by design: a duel seated while the reader is driving survives only until the next `next` — the reader's between-question `next` clears it. Re-opening is two taps; a flow driver (future) will own this.
- The vote tie-break is pool position (first-vote-first), flagged with a `ponytail:` comment in `resolveDuel` — the spec's "reached the count first" needs per-vote timestamps, noted as the upgrade path.
