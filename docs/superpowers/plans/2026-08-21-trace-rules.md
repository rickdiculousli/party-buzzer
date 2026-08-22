# Trace Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the invariants that currently live in comments executable: rules about state shape, moment ordering, phase transitions, and audio overlap, checked live against a real `Hub` under `node:test`.

**Architecture:** One new file `tools/rules.ts` holds the rule types, five factories, the checker, the audio-window derivation, and the starter `RULES` table. Tests drive `Hub` directly with an in-memory tracer (one new `HubOpts` field) and assert zero violations. Say-windows reach the checker through a new `onClip` observer on `ReaderOpts`.

**Tech Stack:** Node 26 native TypeScript, `node:test` + `node:assert/strict` only. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-trace-rules-design.md`

## Global Constraints

- Node 26.7.0, native TS: relative imports carry `.ts` extensions; no `enum`, `namespace`, or parameter properties.
- Tests use `node:test` and `node:assert/strict` only; no new runtime dependencies.
- `npm test` globs `server/`, `server/modes/`, `client/`, `shared/`, `tools/` — `tools/rules.test.ts` is picked up automatically.
- Run single files with `node --test tools/rules.test.ts` (a bare directory does not work on Node 26).
- Two deliberate deviations from the spec, both ambiguity fixes found while grounding:
  - **Rule 6 is non-decreasing, not strictly increasing.** Two buzzes can clamp to the same `deltaMs` (same millisecond); a strict rule would false-fire on a legal tie. The rule is named "order is ordered" and checks `>=`.
  - **The speech observer lives on `ReaderOpts`, not `speech.ts`.** The playback sites that hold a `Clip` (with `durationMs`) are in `server/reader.ts` (`this.speech.play(clip.path, …)`); `speech.play` itself only sees a path. Same hook, placed where the data is.
  - Rule 5 also allows cause `host:undo` — undo restores a score snapshot by design, so it moves `scores.*` legally.

---

### Task 1: In-memory tracer on the Hub

**Files:**
- Modify: `server/hub.ts` (`HubOpts` at line 50, constructor at line 99)
- Test: `server/trace.test.ts` (append)

**Interfaces:**
- Consumes: `Tracer` from `server/trace.ts` (`(cause: string, state: State) => void`), already imported by `hub.ts`.
- Produces: `HubOpts.tracer?: Tracer` — every later task's tests collect frames through it.

- [ ] **Step 1: Write the failing test**

Append to `server/trace.test.ts` (reuse the file's existing `conn` helper and `newState`):

```ts
test('hub calls a passed tracer with cause and state', () => {
  const frames: Frame[] = []
  const hub = new Hub(newState(), {
    tracer: (cause, state) =>
      frames.push({ seq: frames.length, t: Date.now(), cause, state: structuredClone(state) }),
  })
  const ada = conn('player')
  hub.send(ada, { t: 'hello', role: 'player', name: 'Ada' })
  assert.equal(frames.length, 1)
  assert.equal(frames[0].cause, 'join')
  assert.equal(frames[0].state.players[0].name, 'Ada')
})
```

Add `type Frame` to the existing `server/trace.ts` import in the test file if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/trace.test.ts`
Expected: FAIL — `tracer` is not a known `HubOpts` field (type error under strip-types surfaces as the tracer never being called: `frames.length` is 0).

- [ ] **Step 3: Implement**

In `server/hub.ts`, add to `HubOpts` (next to `tracePath`):

```ts
  /** In-memory tap, preferred over tracePath. Tests drive this; TRACE=1 uses the file. */
  tracer?: Tracer
```

Change the constructor line:

```ts
    this.trace = opts.tracer ?? (opts.tracePath ? makeTracer(opts.tracePath) : () => {})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/trace.test.ts`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add server/hub.ts server/trace.test.ts
git commit -m "hub: in-memory tracer opt, so tests can collect frames"
```

---

### Task 2: Rule core and the four frame factories

**Files:**
- Create: `tools/rules.ts`
- Test: `tools/rules.test.ts`

**Interfaces:**
- Consumes: `Frame` from `server/trace.ts`; `momentOfFrame`, `diffStates` from `tools/trace.ts`; `Moment` from `shared/wall.ts`; `COLLECT_MS` from `shared/protocol.ts`.
- Produces (used by Tasks 3–5): `Violation`, `Window`, `Ctx`, `Rule`, `check(frames, rules, ctx)`, `whenever`, `neverFollows`, `phaseGraph`, `minGap`.

- [ ] **Step 1: Write the failing tests**

Create `tools/rules.test.ts`. Frames for the checker units are synthetic — the `as never` cast is the established pattern in `tools/trace.test.ts` for building a partial `State`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { whenever, neverFollows, phaseGraph, minGap, check, type Rule } from './rules.ts'
import type { Frame } from '../server/trace.ts'

const frame = (seq: number, cause: string, phase: string, order: unknown[] = [], scores = {}): Frame =>
  ({ seq, t: 1000 + seq * 100, cause, state: { round: { phase, armedAt: 900, order }, players: [], scores, game: { id: 'trivia' } } }) as never

test('whenever flags a frame where must fails', () => {
  const rule = whenever('lock needs a leader',
    (_prev, f) => f.state.round.phase === 'LOCKED',
    (_prev, f) => f.state.round.order.length > 0)
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED', [{ playerId: 'a' }])]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(bad, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].rule, 'lock needs a leader')
  assert.equal(v[0].seq, 1)
})

test('neverFollows flags an adjacent moment pair', () => {
  // buzz:open immediately followed by idle:welcome is a legal-shape pair for
  // the factory test — the real moment pairs live in the RULES table.
  const rule = neverFollows('no welcome after open', 'buzz:open', 'idle:welcome')
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    { ...frame(1, 'host:resetRound', 'IDLE'), state: { ...frame(1, 'host:resetRound', 'IDLE').state, players: [] } },
  ]
  // ARMED with armedAt in the past is buzz:open; IDLE with no players is idle:welcome.
  const v = check(frames, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].seq, 1)
})

test('phaseGraph flags an illegal transition and allows legal ones', () => {
  const rule = phaseGraph('phases', {
    IDLE: ['ARMED'], ARMED: ['COLLECTING', 'IDLE'], COLLECTING: ['LOCKED', 'IDLE'], LOCKED: ['IDLE'],
  })
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'buzz', 'COLLECTING'), frame(2, 'settle', 'LOCKED'), frame(3, 'host:next', 'IDLE')]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  assert.equal(check(bad, [rule], {}).length, 1)
})

test('minGap flags a settle that lands early', () => {
  const rule = minGap('full collect window', 'buzz', 'settle', 1000)
  const ok = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 2500 }]
  const early = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 1500 }]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(early, [rule], {})
  assert.equal(v.length, 1)
  assert.match(v[0].detail, /500/)
})

test('check runs every rule and returns every violation', () => {
  const rules: Rule[] = [
    whenever('a', () => true, () => false),
    whenever('b', () => true, () => false),
  ]
  const v = check([frame(0, 'x', 'IDLE'), frame(1, 'y', 'IDLE')], rules, {})
  assert.equal(v.length, 4)
})
```

Note on the `neverFollows` test: `momentOfFrame` maps `ARMED` with `armedAt <= t` to `buzz:open` and `IDLE` with no players to `idle:welcome` — confirm against `shared/wall.ts` `momentOf` when writing the test, and adjust the pair if the mapping differs. The factory doesn't care which pair; the test just needs one that fires.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tools/rules.ts`**

```ts
/**
 * Invariants over a trace. A rule is a predicate over the whole frame list;
 * the factories build the common shapes, and a rule that outgrows them drops
 * to the core shape — there is no parser and no ceiling.
 */
import { momentOfFrame, diffStates } from './trace.ts'
import type { Frame } from '../server/trace.ts'
import type { Moment } from '../shared/wall.ts'

export type Violation = { rule: string; seq: number; detail: string }
export type Window = { kind: string; start: number; end: number }
export type Ctx = { speech?: Window[] }
export type Rule = {
  name: string
  check(frames: Frame[], ctx: Ctx): Violation[]
}

/** Run every rule; return every violation, not the first. */
export function check(frames: Frame[], rules: Rule[], ctx: Ctx): Violation[] {
  return rules.flatMap((r) => r.check(frames, ctx))
}

const v = (rule: string, f: Frame, detail: string): Violation => ({ rule, seq: f.seq, detail })

/** At every frame where `when` holds, `must` must hold. */
export function whenever(
  name: string,
  when: (prev: Frame | undefined, f: Frame) => boolean,
  must: (prev: Frame | undefined, f: Frame) => boolean,
): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        return when(prev, f) && !must(prev, f)
          ? [v(name, f, `${f.cause} at ${f.state.round.phase}`)]
          : []
      }),
  }
}

/** Moment b never immediately follows moment a. */
export function neverFollows(name: string, a: Moment, b: Moment): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        return prev && momentOfFrame(prev) === a && momentOfFrame(f) === b
          ? [v(name, f, `${a} -> ${b} on ${f.cause}`)]
          : []
      }),
  }
}

/** Every round.phase transition is an edge in the graph. */
export function phaseGraph(name: string, graph: Record<string, string[]>): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        if (!prev) return graph[f.state.round.phase] ? [] : [v(name, f, `opens in ${f.state.round.phase}`)]
        const from = prev.state.round.phase, to = f.state.round.phase
        return from !== to && !graph[from]?.includes(to)
          ? [v(name, f, `${from} -> ${to} on ${f.cause}`)]
          : []
      }),
  }
}

/** From a causeA frame to the next causeB frame, at least ms elapse. */
export function minGap(name: string, causeA: string, causeB: string, ms: number): Rule {
  return {
    name,
    check: (frames) => {
      let lastA: Frame | undefined
      const out: Violation[] = []
      for (const f of frames) {
        if (f.cause === causeA) lastA = f
        else if (f.cause === causeB && lastA && f.t - lastA.t < ms) {
          out.push(v(name, f, `${f.t - lastA.t}ms < ${ms}ms between ${causeA} and ${causeB}`))
          lastA = undefined // one violation per window, not one per causeB
        }
      }
      return out
    },
  }
}

/** True when any scores.* leaf moved between the two frames. */
export function scoresMoved(prev: Frame, f: Frame): boolean {
  return diffStates(prev.state, f.state).some((c) => c.path.startsWith('scores.'))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/rules.ts tools/rules.test.ts
git commit -m "rules: core checker and the frame factories"
```

---

### Task 3: Audio windows and the overlap factory

**Files:**
- Modify: `tools/rules.ts` (append)
- Test: `tools/rules.test.ts` (append)

**Interfaces:**
- Consumes: `RECIPES`, `span` from `client/cues.ts` (pure data + arithmetic, Node-safe); `TUNE` from `client/sound.ts` (module is imported by `client/tunables.test.ts` under Node already, so importing it here is safe); the Task 2 core.
- Produces: `cueWindows(frames): Window[]`, `noOverlap(name, kindA, kindB)`.

Facts the derivation models (verified against the client):
- `client/Board.tsx:284-296`: when the published order grows by k, the board plays `leader` for the first-ever entry and `stamp` for the rest, spaced by `markGap()` = `TUNE['--mark-stagger']` (100).
- `client/useReveal.ts:63-74`: when `round.award` appears, the board plays `award` (points >= 0) or `penalty` (points < 0).
- `span(RECIPES[cue])` gives each cue's sounding length in ms.

- [ ] **Step 1: Write the failing tests**

Append to `tools/rules.test.ts`:

```ts
import { cueWindows, noOverlap, type Window } from './rules.ts'
import { span } from '../client/cues.ts'
import { RECIPES } from '../client/cues.ts'
import { TUNE } from '../client/sound.ts'

test('cueWindows: order growth is leader then stamps, spaced by the stagger', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]),
    frame(2, 'buzz', 'COLLECTING', [{ playerId: 'a' }, { playerId: 'b' }]),
    frame(3, 'settle', 'LOCKED', [{ playerId: 'a' }, { playerId: 'b' }]),
  ]
  const w = cueWindows(frames)
  const gap = TUNE['--mark-stagger']
  assert.equal(w.length, 2)
  assert.deepEqual(w[0], { kind: 'cue', cue: 'leader', start: frames[1].t, end: frames[1].t + span(RECIPES.leader!) })
  assert.deepEqual(w[1], { kind: 'cue', cue: 'stamp', start: frames[2].t, end: frames[2].t + span(RECIPES.stamp!) })
  void gap // spacing is per new entry's own frame; assert the gap constant is what the test thinks
  assert.equal(gap, 100)
})
```

Wait — check the board semantics against the frame facts before finalizing this test: the board spaces entries by `markGap` *within one render's batch of new marks*, but each new frame here is its own broadcast, so the second buzz's `stamp` fires at its own frame time, not `frames[1].t + gap`. The model above matches that. If `settle` adds no new entries, it adds no cue.

```ts
test('cueWindows: an award appearing fires award or penalty', () => {
  const withAward = (seq: number, points: number): Frame =>
    ({ ...frame(seq, 'host:correct', 'LOCKED', [{ playerId: 'a' }]),
       state: { ...frame(seq, 'host:correct', 'LOCKED', [{ playerId: 'a' }]).state,
                round: { ...frame(seq, 'host:correct', 'LOCKED').state.round, award: { name: 'Ada', points } } } }) as never
  const frames = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a' }]), withAward(1, 200), withAward(2, -50)]
  const w = cueWindows(frames).filter((x) => x.cue !== 'leader')
  assert.deepEqual(w.map((x) => x.cue), ['award', 'penalty'])
})

test('noOverlap flags intersecting windows of the two kinds', () => {
  const rule = noOverlap('voice over room', 'say', 'cue')
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]), // leader cue at t=1100
  ]
  const overlapping: Window[] = [{ kind: 'say', start: 1000, end: 1200 }]
  const clear: Window[] = [{ kind: 'say', start: 0, end: 900 }]
  assert.deepEqual(check(frames, [rule], { speech: clear }), [])
  assert.equal(check(frames, [rule], { speech: overlapping }).length, 1)
})
```

Note: `Window` gains a `cue` field for cue windows (`{kind:'cue', cue:'leader', …}`) so violation details can name the sound; speech windows just omit it. Make the type `Window = { kind: string; cue?: string; start: number; end: number }` in `tools/rules.ts` (edit the Task 2 definition).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/rules.test.ts`
Expected: FAIL — `cueWindows`/`noOverlap` not exported.

- [ ] **Step 3: Implement**

Append to `tools/rules.ts`:

```ts
import { RECIPES, span } from '../client/cues.ts'
import { TUNE } from '../client/sound.ts'

/**
 * What the board plays, derived from the same facts the board reads. Starts
 * are approximate by one settle dwell — the dwell is a client-side animation
 * clock the trace cannot see (same caveat momentOfFrame documents).
 */
export function cueWindows(frames: Frame[]): Window[] {
  const out: Window[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const prev = frames[i - 1]
    const before = prev?.state.round.order.length ?? 0
    const after = f.state.round.order.length
    for (let j = before; j < after; j++) {
      const cue = j === 0 ? 'leader' : 'stamp'
      const dur = span(RECIPES[cue]!)
      out.push({ kind: 'cue', cue, start: f.t, end: f.t + dur })
    }
    const had = prev?.state.round.award
    const now = f.state.round.award
    if (now && (!had || JSON.stringify(had) !== JSON.stringify(now))) {
      const cue = now.points < 0 ? 'penalty' : 'award'
      const dur = span(RECIPES[cue]!)
      out.push({ kind: 'cue', cue, start: f.t, end: f.t + dur })
    }
  }
  return out
}

/** No window of kindA intersects a window of kindB. */
export function noOverlap(name: string, kindA: string, kindB: string): Rule {
  return {
    name,
    check: (frames, ctx) => {
      const all = [...cueWindows(frames), ...(ctx.speech ?? [])]
      const as = all.filter((w) => w.kind === kindA)
      const bs = all.filter((w) => w.kind === kindB)
      const out: Violation[] = []
      for (const a of as)
        for (const b of bs)
          if (a.start < b.end && b.start < a.end) {
            // Nearest frame gets the blame; the window pair is the detail.
            const f = frames.find((x) => x.t >= Math.max(a.start, b.start)) ?? frames[frames.length - 1]
            out.push({ rule: name, seq: f?.seq ?? 0, detail: `${kindA} [${a.start},${a.end}] x ${kindB}${b.cue ? `(${b.cue})` : ''} [${b.start},${b.end}]` })
          }
      return out
    },
  }
}
```

Check `round.award`'s type in `shared/protocol.ts` (`Award` shape) and that `RECIPES.leader`/`stamp` are non-null (they are — `satisfies Partial<Record<Cue, Recipe>>` but both keys present; the `!` is honest).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/rules.ts tools/rules.test.ts
git commit -m "rules: audio windows and the overlap factory"
```

---

### Task 4: The starter RULES table

**Files:**
- Modify: `tools/rules.ts` (append)
- Test: `tools/rules.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 2–3; `COLLECT_MS` from `shared/protocol.ts`.
- Produces: `RULES: Rule[]` — the table Task 5 asserts against real Hub traces.

- [ ] **Step 1: Write the failing tests**

Each rule gets one deliberately violating synthetic sequence, so a rule that can never fire is caught. Append to `tools/rules.test.ts`:

```ts
import { RULES } from './rules.ts'

const ruleNamed = (name: string): Rule => {
  const r = RULES.find((x) => x.name === name)
  assert.ok(r, `RULES is missing "${name}"`)
  return r
}

test('RULES: lock needs a leader fires on an empty LOCKED', () => {
  const v = check([frame(0, 'settle', 'LOCKED')], [ruleNamed('lock needs a leader')], {})
  assert.equal(v.length, 1)
})

test('RULES: scores move only on verdicts', () => {
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'buzz', 'COLLECTING', [], { ada: 400 })]
  const okUndo = [frame(0, 'host:correct', 'LOCKED'), frame(1, 'host:undo', 'IDLE', [], { ada: 0 })]
  assert.equal(check(bad, [ruleNamed('scores move only on verdicts')], {}).length, 1)
  assert.deepEqual(check(okUndo, [ruleNamed('scores move only on verdicts')], {}), [])
})

test('RULES: order is ordered allows ties, flags inversions', () => {
  const tied = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a', deltaMs: 0 }, { playerId: 'b', deltaMs: 0 }])]
  const inverted = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a', deltaMs: 5 }, { playerId: 'b', deltaMs: 2 }])]
  assert.deepEqual(check(tied, [ruleNamed('order is ordered')], {}), [])
  assert.equal(check(inverted, [ruleNamed('order is ordered')], {}).length, 1)
})

test('RULES: voice ends at the buzz — a say window outliving it fires', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]), // t = 1100
  ]
  const speech = [{ kind: 'say', start: 500, end: 1300 }]
  assert.equal(check(frames, [ruleNamed('voice ends at the buzz')], { speech }).length, 1)
  assert.deepEqual(check(frames, [ruleNamed('voice ends at the buzz')], { speech: [{ kind: 'say', start: 500, end: 1100 }] }), [])
})
```

(The `phaseGraph`, `neverFollows`, and `minGap` rows of `RULES` are exercised by their factory tests in Task 2 plus the Task 5 integration run; a second synthetic violation each would test the factory, not the table.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/rules.test.ts`
Expected: FAIL — `RULES` not exported.

- [ ] **Step 3: Implement**

Append to `tools/rules.ts`:

```ts
import { COLLECT_MS } from '../shared/protocol.ts'

/**
 * The table is the spec. A bug investigated in trace.jsonl graduates into a
 * row here. Phase edges enumerated from applyHostAction in server/state.ts
 * plus the hub's own settle/buzz transitions.
 */
export const RULES: Rule[] = [
  whenever('lock needs a leader',
    (_p, f) => f.state.round.phase === 'LOCKED',
    (_p, f) => f.state.round.order.length > 0),

  neverFollows('no lock after award', 'verdict:award', 'answer:locked'),

  phaseGraph('phase graph', {
    IDLE: ['ARMED'],
    ARMED: ['COLLECTING', 'IDLE'],
    COLLECTING: ['LOCKED', 'IDLE'],
    LOCKED: ['IDLE'],
  }),

  minGap('full collect window', 'buzz', 'settle', COLLECT_MS),

  // Undo restores a score snapshot by design, so it moves scores legally.
  whenever('scores move only on verdicts',
    (p, f) => !!p && scoresMoved(p, f),
    (_p, f) => ['host:correct', 'host:wrong', 'host:undo'].includes(f.cause)),

  // Ties are legal: two presses can clamp to the same deltaMs.
  whenever('order is ordered',
    (_p, f) => f.state.round.order.length > 1,
    (_p, f) => f.state.round.order.every((b, i, o) => i === 0 || o[i - 1].deltaMs <= b.deltaMs)),

  noOverlap('voice never talks over the room', 'say', 'cue'),

  // A buzz kills the clip server-side, so the window must end with it. Core
  // shape — no factory names "the first buzz at or after this window's start".
  {
    name: 'voice ends at the buzz',
    check: (frames, ctx) =>
      (ctx.speech ?? []).flatMap((w) => {
        const buzz = frames.find((f) => f.cause === 'buzz' && f.t >= w.start)
        return buzz && w.end > buzz.t
          ? [{ rule: 'voice ends at the buzz', seq: buzz.seq, detail: `say ends ${w.end}, buzz at ${buzz.t}` }]
          : []
      }),
  },
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/rules.test.ts`
Expected: PASS — then `npm test` for the whole suite (nothing else should have moved).

- [ ] **Step 5: Commit**

```bash
git add tools/rules.ts tools/rules.test.ts
git commit -m "rules: the starter table"
```

---

### Task 5: Speech observer + integration against a real Hub

**Files:**
- Modify: `server/reader.ts` (`ReaderOpts` near line 44; the two `this.speech.play` sites at lines 623 and 685)
- Test: `tools/rules.test.ts` (append a new section)

**Interfaces:**
- Consumes: `RULES`, `check` from Task 4; `HubOpts.tracer` from Task 1; the `conn`/`hub.send` driving pattern from `server/trace.test.ts`; `Clip` from `server/speech.ts`.
- Produces: `ReaderOpts.onClip?: (clip: Clip, startedAt: number) => void`.

- [ ] **Step 1: Write the failing integration tests**

Append to `tools/rules.test.ts`. These need a real `Hub` and real timers — reuse the `conn` helper pattern from `server/trace.test.ts` and `newState` from `server/state.ts` (import them directly; if `server/trace.test.ts`'s helper isn't exported, copy the five lines). Timing: buzzes must wait out `ARM_DELAY_MS` (300) after `arm`, and `settle` arrives `COLLECT_MS` (1000) after the first buzz — small real sleeps are the established pattern in `server/reader.test.ts`.

```ts
import { Hub, type Conn } from '../server/hub.ts'
import { newState } from '../server/state.ts'
import type { ServerMsg, ClientMsg } from '../shared/protocol.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const drive = () => {
  const frames: Frame[] = []
  const hub = new Hub(newState(), {
    tracer: (cause, state) =>
      frames.push({ seq: frames.length, t: Date.now(), cause, state: structuredClone(state) }),
  })
  const conns = new Map<string, Conn>()
  const connFor = (name: string): Conn => {
    let c = conns.get(name)
    if (!c) {
      c = { id: name, role: 'player', send: (_msg: ServerMsg) => {} }
      conns.set(name, c)
      hub.add(c)
      hub.send(c, { t: 'hello', role: 'player', name } as ClientMsg)
    }
    return c
  }
  const host: Conn = { id: 'host', role: 'host', send: () => {} }
  hub.add(host)
  hub.send(host, { t: 'hello', role: 'host' } as ClientMsg)
  return { hub, frames, connFor, host }
}

test('integration: photo finish, correct, next — zero violations', async () => {
  const { hub, frames, connFor, host } = drive()
  const ada = connFor('Ada'), bo = connFor('Bo')
  hub.send(host, { t: 'host', action: { a: 'arm' } } as ClientMsg)
  await sleep(350) // past ARM_DELAY_MS
  hub.send(ada, { t: 'buzz', at: Date.now() } as ClientMsg)
  hub.send(bo, { t: 'buzz', at: Date.now() + 40 } as ClientMsg)
  await sleep(1100) // past COLLECT_MS — settle lands
  hub.send(host, { t: 'host', action: { a: 'correct' } } as ClientMsg)
  hub.send(host, { t: 'host', action: { a: 'next' } } as ClientMsg)
  assert.deepEqual(check(frames, RULES, {}), [])
})

test('integration: wrong answer then rebound — zero violations', async () => {
  const { hub, frames, connFor, host } = drive()
  const ada = connFor('Ada'), bo = connFor('Bo')
  hub.send(host, { t: 'host', action: { a: 'arm' } } as ClientMsg)
  await sleep(350)
  hub.send(ada, { t: 'buzz', at: Date.now() } as ClientMsg)
  await sleep(1100)
  hub.send(host, { t: 'host', action: { a: 'wrong' } } as ClientMsg)
  hub.send(bo, { t: 'buzz', at: Date.now() } as ClientMsg)
  await sleep(1100)
  hub.send(host, { t: 'host', action: { a: 'correct' } } as ClientMsg)
  assert.deepEqual(check(frames, RULES, {}), [])
})
```

Rebound mechanics: check `server/state.ts` for what `wrong` does to the phase (it may go back to `ARMED` directly, or need a `rebound` action — the phase graph in Task 4 must contain whatever edges this test actually takes; adjust the graph to the real machine, never the other way around). Also verify the exact `ClientMsg` shapes against `shared/protocol.ts` (`host` action union, `buzz` payload field name) and fix the casts to match.

Audio rule integration — the reader path with a stubbed speech, mirroring `server/reader.test.ts`'s stub, now also recording windows through the new hook:

```ts
test('integration: a buzz cuts the voice, so say and cue never overlap', async () => {
  // Build a Hub + Reader with stubbed speech the way server/reader.test.ts does.
  // ReaderOpts gains onClip; record {kind:'say', start, end} windows from it.
  // Drive: read a pack, buzz mid-fragment (stubbed play resolves on stop).
  // Assert check(frames, RULES, { speech: windows }) is empty.
})
```

This test's shape depends on the reader's existing test scaffolding — copy the stub setup from `server/reader.test.ts:101-167` (`speech.spoken`, `speech.play` override, fake pack). The say-window ends when the stub's `stop()` runs: record `end = Date.now()` there. If the reader test pack isn't importable, point the Reader at a two-question pack written to a temp dir the way `server/reader.test.ts` does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/rules.test.ts`
Expected: FAIL — `ReaderOpts.onClip` doesn't exist (audio test), and any real phase edges missing from the Task 4 graph surface here as violations to reconcile (fix the graph to the machine, per above).

- [ ] **Step 3: Implement the speech observer**

In `server/reader.ts`, add to `ReaderOpts` (near `speech?: Speech`, line 44):

```ts
  /** Observer for tests: every clip that starts playing, with its start time. */
  onClip?: (clip: Clip, startedAt: number) => void
```

At both `this.speech.play(clip.path, …)` / `this.speech.play(path)` sites, capture the clip being played and call the hook right after play starts. The second site (line 685) plays a path directly — check what clip/duration is in scope there; if only a path exists, construct the `Clip` from the nearest duration source the reader already has (it renders before playing, so a `Clip` is almost always in scope). If one site genuinely has no duration, pass `durationMs: 0` and let the test treat 0 as "until stopped" — the say-window's `end` comes from `stop()` in the stub anyway.

Call shape at each site:

```ts
const pb = this.speech.play(clip.path, atMs)
this.opts.onClip?.(clip, Date.now())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/rules.test.ts` then `npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add server/reader.ts tools/rules.test.ts
git commit -m "rules: speech observer and live integration against a real Hub"
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (the Verifying section, after the `npm run trace` paragraph)

- [ ] **Step 1: Add the paragraph**

```md
`tools/rules.ts` is where a bug found in a trace graduates into an invariant:
`RULES` is the table, checked live against a driven `Hub` in
`tools/rules.test.ts`. New invariants go through the factories
(`whenever`/`neverFollows`/`phaseGraph`/`minGap`/`noOverlap`) when one fits and
the core `Rule` shape when none does.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rules table in Verifying"
```
