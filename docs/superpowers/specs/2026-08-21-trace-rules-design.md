# Trace Rules Design

2026-08-21. Turns the state trace into an invariant checker: rules about what
can never be true in a state, what can never follow what, and which sounds may
never overlap — checked live against a real `Hub` under `node:test`.

## Why

The trace (`server/trace.ts`, `tools/trace.ts`) gives every state transition a
cause, a timestamp, and a moment. That is exactly the input an invariant needs.
Today those invariants live in comments ("the reader must not talk over the
room", "nothing outranks the moment ladder") and get re-derived by hand after
each display bug. This makes them executable, so the class of bug the trace was
built to find becomes the class of bug a test catches.

Traces under test are **live-driven in memory**: a test drives `Hub` directly
(the existing `server/trace.test.ts` pattern), collecting frames through an
in-memory tracer, and asserts `check()` returns no violations. No server boot,
no files, deterministic. `trace.jsonl` remains the discovery tool — a bug
investigated there graduates into a rule here.

## Components

### `tools/rules.ts` (new, the only new file of substance)

Rule types, factories, the checker, the audio-window derivation, and the
starter rule set. One file; the rule table is the spec, and splitting the table
from the engine would make both harder to read.

Imports: `momentOfFrame`, `diffStates`, `Frame` from `tools/trace.ts`;
`RECIPES`, `span` from `client/cues.ts` (pure data); `COLLECT_MS` from
`shared/protocol.ts`; `Moment` from `shared/wall.ts`.

### `server/hub.ts` (one line)

`HubOpts` gains `tracer?: Tracer` alongside `tracePath`; the constructor
prefers it when present. The composition root keeps mapping `TRACE=1` to
`tracePath: 'trace.jsonl'`. Tests pass a collector:

```ts
const frames: Frame[] = []
const hub = new Hub(newState(), { tracer: (cause, state) =>
  frames.push({ seq: frames.length, t: Date.now(), cause, state: structuredClone(state) }) })
```

### `server/speech.ts` (small hook)

`say` gains an optional observer so say-windows are visible without `afplay`:
the playback site calls `opts.onClip?.(clip, startedAt)` where `clip` already
carries `durationMs`. Tests record windows; production never sets it.

## Rule model

One core shape; factories build it. A rule that outgrows every factory drops
to the core shape, so there is no ceiling and no parser.

```ts
export type Violation = { rule: string; seq: number; detail: string }
export type Ctx = { speech?: Window[] }
export type Rule = {
  name: string
  check(frames: Frame[], ctx: Ctx): Violation[]
}
```

Factories:

- `whenever(name, when, must)` — at every frame where `when(prev, f)` holds,
  `must(prev, f)` must hold. State-shape rules.
- `neverFollows(name, a, b)` — moment `b` (via `momentOfFrame`) never
  immediately follows moment `a`.
- `phaseGraph(name, graph)` — every `round.phase` transition is an edge in the
  given graph. The round state machine as data.
- `minGap(name, causeA, causeB, ms)` — from the first `causeA` to the next
  `causeB`, at least `ms` elapse. Imports `COLLECT_MS`, never restates it.
- `noOverlap(name, kindA, kindB)` — no window of kind A intersects a window of
  kind B, over `cueWindows(frames)` plus `ctx.speech`.

`check(frames, rules, ctx)` runs every rule and returns every violation, not
the first. A `Violation.detail` names the leaf, the values, and the bound.

Windows are `{ kind: string; start: number; end: number }`.

## Starter rule set

`RULES` in `tools/rules.ts`:

1. **lock needs a leader** — `whenever` phase is `LOCKED`, `round.order` is
   non-empty.
2. **no lock after award** — `neverFollows('verdict:award', 'answer:locked')`
   (the rebound-ordering class).
3. **phase graph** — `IDLE→ARMED→COLLECTING→LOCKED→IDLE` plus the legal exits
   (`ARMED→IDLE`, `COLLECTING→IDLE` on `next`/`resetRound`), enumerated from
   `applyHostAction` in `server/state.ts`.
4. **full collect window** — `minGap('buzz', 'settle', COLLECT_MS)` per round.
5. **scores move only on verdicts** — `whenever` a `scores.*` leaf changed
   (via `diffStates`), the cause is `host:correct` or `host:wrong`.
6. **order is ordered** — `round.order` entries strictly increase in `deltaMs`.
7. **voice never talks over the room** — `noOverlap('say', 'cue')`, plus a
   `whenever`: every say-window ends at or before the first `buzz` frame of
   its round.

## Audio derivation

`cueWindows(frames)` models what the board plays, from the same facts the
board reads:

- `round.order` grows by k between frames → k windows at
  `f.t + i · markGap`; the first is `leader`, the rest `stamp`. `markGap()`
  reads a CSS tunable and needs a DOM, so the checker uses its `TUNE` fallback
  from `client/sound.ts` — the same value, the Node-readable copy. Durations
  from `span(RECIPES[cue])`.
- `round.award` appears → one `award` (or `penalty`) window at that frame.

Say-windows are `ctx.speech`, supplied by the test from the `speech.ts` hook.

ponytail: the board's `settled`/`retired` dwells are client-side animation
clocks the trace cannot see, so cue window starts are approximate by one
dwell; the overlap rule carries a tolerance, and exact dwell timing stays the
motion harness's job — same caveat `momentOfFrame` already documents.

## Testing

`tools/rules.test.ts` (picked up by the `npm test` glob), three layers:

1. **Checker units** — synthetic frames per factory, including a deliberately
   violating sequence each, so a rule that can never fire is caught.
2. **Integration** — a real `Hub` with the in-memory tracer driven through the
   standard scenarios (photo finish, correct, rebound, duel entry) asserts
   `check(frames, RULES)` is empty.
3. **Audio** — a stubbed speech hook through a buzz-cut reading asserts rule 7.

No new message types, no `State` changes, no runtime dependencies.
