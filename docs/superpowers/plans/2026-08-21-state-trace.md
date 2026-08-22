# State Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-side tap that records every state transition to `trace.jsonl`, plus a CLI that prints it as a compact diff timeline agents can drill into.

**Architecture:** `Hub.changed()` — the single funnel every mutation already flows through — gains a `cause` label and calls a tracer that appends `{seq, t, cause, state}` frames. `tools/trace.ts` reads the file, flattens states to leaf paths, diffs consecutive frames, and prints one line per transition. All intelligence lives in the CLI; the server change is ~25 lines.

**Tech Stack:** Node 26 native TS (no build step, `.ts` import extensions), `node:test` + `node:assert/strict` only, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-state-trace-design.md`

## Global Constraints

- Node 26.7.0; no `enum`, `namespace`, or constructor parameter properties.
- No new runtime dependencies (only `ws` and `qrcode` exist).
- Tests: `node:test` + `node:assert/strict` only. Run with `node --test <file>`.
- Boot must never touch the network from a test.
- `trace.jsonl` is gitignored.
- Comments state the rule, not the change; no history in comments.

---

### Task 1: The tracer (`server/trace.ts`)

**Files:**
- Create: `server/trace.ts`
- Test: `server/trace.test.ts`

**Interfaces:**
- Consumes: `State` from `shared/protocol.ts`.
- Produces: `makeTracer(path: string): Tracer` where `type Tracer = (cause: string, state: State) => void`. Task 2 wires it into the hub.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/trace.test.ts`
Expected: FAIL — `Cannot find module './trace.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { appendFileSync, writeFileSync } from 'node:fs'
import type { State } from '../shared/protocol.ts'

export type Tracer = (cause: string, state: State) => void

/** One JSONL frame per state transition; `tools/trace.ts` is the reader. */
export type Frame = { seq: number; t: number; cause: string; state: State }

/**
 * A trace is one investigation, not an archive: creating the tracer truncates
 * whatever a previous boot left, and frames then append.
 * ponytail: no size cap — a full night is tens of MB; rotate by size if that
 * ever matters.
 */
export function makeTracer(path: string): Tracer {
  writeFileSync(path, '')
  let seq = 0
  return (cause, state) => {
    const frame: Frame = { seq: seq++, t: Date.now(), cause, state: structuredClone(state) }
    appendFileSync(path, JSON.stringify(frame) + '\n')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/trace.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/trace.ts server/trace.test.ts
git commit -m "trace: the tap's writer half"
```

---

### Task 2: Wire the hub — `cause` labels and the tap call

**Files:**
- Modify: `server/hub.ts` (9 `changed()` call sites + the method itself + `HubOpts` + constructor)
- Test: `server/trace.test.ts` (append)

**Interfaces:**
- Consumes: `makeTracer`, `Tracer` from Task 1.
- Produces: `HubOpts.tracePath?: string` — presence turns tracing on. Frame `cause` strings the CLI's `--round` filter (Task 4) relies on: `host:arm`, `host:correct`, `host:wrong`, `host:next`, `buzz`, `settle`.

Every existing `this.changed()` call gets a present-tense cause naming the message or timer that mutated:

| Site (current line) | Cause |
|---|---|
| `remove()` — disconnect | `'leave'` |
| host action dispatch | `` `host:${msg.action.a}` `` |
| `act()` — useItem branch | `'item'` |
| `act()` — duel branch | `'duel'` |
| `act()` — fragment/extend/setlist/module fallthrough | `` `act:${name}` `` |
| `join()` | `'join'` |
| `buzz()` | `'buzz'` |
| `reveal()` | `'reveal'` |
| `settle()` | `'settle'` |

- [ ] **Step 1: Write the failing test** (append to `server/trace.test.ts`)

```ts
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
```


- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/trace.test.ts`
Expected: FAIL — `tracePath` not a known HubOpts property / no frames written

- [ ] **Step 3: Implement**

In `server/hub.ts`:

```ts
// HubOpts gains:
  /** Presence turns the trace tap on; the composition root maps TRACE=1 to it. */
  tracePath?: string

// class fields gain:
  private trace: Tracer

// constructor, after this.reader assignment:
  this.trace = opts.tracePath ? makeTracer(opts.tracePath) : () => {}

// the funnel:
  private changed(cause = 'change'): void {
    this.trace(cause, this.state)
    this.broadcast()
    this.onChange(this.state)
  }
```

Then update the 9 call sites per the table above. Imports: `import { makeTracer, type Tracer } from './trace.ts'`.

- [ ] **Step 4: Run tests**

Run: `node --test server/trace.test.ts server/hub.test.ts`
Expected: PASS — new tests pass and existing hub tests are unaffected

- [ ] **Step 5: Commit**

```bash
git add server/hub.ts server/trace.test.ts
git commit -m "trace: the hub names each transition and the tap records it"
```

---

### Task 3: CLI — diff engine and the timeline

**Files:**
- Create: `tools/trace.ts`
- Test: `tools/trace.test.ts`

**Interfaces:**
- Consumes: `Frame` type from `server/trace.ts`; `momentOf`, `type Moment` from `shared/wall.ts`.
- Produces (all exported for the test): `flatten(v: unknown, prefix?: string): Map<string, string>`, `diffStates(a: State, b: State): Change[]` where `type Change = { path: string; from?: string; to?: string }`, `timelineLine(f: Frame, prev: Frame | undefined): string`, `momentOfFrame(f: Frame): Moment`, `readTrace(path: string): Frame[]`. Task 4's filters consume these.

Design notes:
- `flatten` recurses objects and arrays (arrays keyed by index: `round.order.0.playerId`). Leaves are `JSON.stringify`ed primitives; `undefined` fields simply don't appear, so a removed leaf shows as `from` with no `to`.
- `momentOfFrame`: `momentOf(f.state, { open, settled: false, retired: false })` where `open` is `f.t >= f.state.round.armedAt` when `armedAt` is set, else false. `settled`/`retired` are the board's animation clocks and unknowable here — the trace shows the pre-dwell moment; dwell-timing bugs belong to the motion harness. Say exactly that in the comment above the function.
- Timeline line format: `#3 +412ms buzz COLLECTING buzz:collect — round.phase: ARMED→COLLECTING, round.order: +ada@0`. Frame 0 has no delta and no diff (print `—`). Leaf compression: when every change shares a prefix, hoist it. `+path` = added, `-path` = removed, `path: a→b` = changed. Values longer than 40 chars get truncated with `…`.

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { flatten, diffStates, timelineLine, type Change } from './trace.ts'

test('flatten reaches leaves, arrays indexed', () => {
  const m = flatten({ round: { phase: 'ARMED', order: [{ playerId: 'ada', deltaMs: 0 }] }, scores: { ada: 200 } })
  assert.equal(m.get('round.phase'), '"ARMED"')
  assert.equal(m.get('round.order.0.playerId'), '"ada"')
  assert.equal(m.get('scores.ada'), '200')
})

test('diffStates reports changed, added, removed leaves', () => {
  const a = { round: { phase: 'ARMED', order: [] }, players: [{ id: 'a', connected: true }] }
  const b = { round: { phase: 'COLLECTING', order: [{ playerId: 'a' }] }, players: [{ id: 'a', connected: false }], duel: { rule: 'vote' } }
  const d = diffStates(a as never, b as never)
  const by = Object.fromEntries(d.map((c) => [c.path, c]))
  assert.deepEqual(by['round.phase'], { path: 'round.phase', from: '"ARMED"', to: '"COLLECTING"' })
  assert.equal(by['players.0.connected'].to, 'false')
  assert.equal(by['duel.rule'].from, undefined)
  assert.equal(by['duel.rule'].to, '"vote"')
})

test('timelineLine shows seq, delta, cause, phase, moment, diff', () => {
  const prev = { seq: 0, t: 1000, cause: 'host:arm', state: { round: { phase: 'ARMED', armedAt: 900, order: [] }, players: [], scores: {}, game: { id: 'trivia' } } }
  const cur = { seq: 1, t: 1400, cause: 'buzz', state: { ...prev.state, round: { ...prev.state.round, phase: 'COLLECTING', order: [{ playerId: 'ada', name: 'Ada', at: 1400, deltaMs: 0 }] } } }
  const line = timelineLine(cur as never, prev as never)
  assert.match(line, /^#1 \+400ms buzz COLLECTING buzz:/)
  assert.match(line, /round\.phase: "ARMED"→"COLLECTING"/)
})
```

For the moment assertion in the third test, compute the expected moment with `momentOf` directly in the test rather than hardcoding the string — the point is the plumbing, not pinning the ladder.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/trace.test.ts`
Expected: FAIL — `Cannot find module './trace.ts'`

- [ ] **Step 3: Implement `tools/trace.ts`** (engine + bare-timeline CLI only; filters are Task 4)

```ts
/** The read half of the trace: diff the frames, print what moved. */
import { readFileSync } from 'node:fs'
import { momentOf, type Moment } from '../shared/wall.ts'
import type { Frame } from '../server/trace.ts'
import type { State } from '../shared/protocol.ts'

export type Change = { path: string; from?: string; to?: string }

export function readTrace(path: string): Frame[] {
  const text = readFileSync(path, 'utf8').trim()
  return text ? text.split('\n').map((l) => JSON.parse(l)) : []
}

export function flatten(v: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (v === null || typeof v !== 'object') {
    if (prefix) out.set(prefix, JSON.stringify(v) ?? 'undefined')
    return out
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue
    flatten(val, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

export function diffStates(a: State, b: State): Change[] {
  const fa = flatten(a), fb = flatten(b)
  const out: Change[] = []
  for (const [p, to] of fb) {
    const from = fa.get(p)
    if (from !== to) out.push(from === undefined ? { path: p, to } : { path: p, from, to })
  }
  for (const [p, from] of fa) if (!fb.has(p)) out.push({ path: p, from })
  return out
}

/**
 * `settled` and `retired` are the board's animation clocks — the trace cannot
 * know them, so the moment shown is the pre-dwell one. Dwell-timing bugs
 * belong to the motion harness, not here.
 */
export function momentOfFrame(f: Frame): Moment {
  const armedAt = f.state.round.armedAt
  return momentOf(f.state, { open: armedAt != null && f.t >= armedAt, settled: false, retired: false })
}

const clip = (s: string) => (s.length > 40 ? s.slice(0, 39) + '…' : s)

export function timelineLine(f: Frame, prev: Frame | undefined): string {
  const head = `#${f.seq} ${prev ? `+${f.t - prev.t}ms` : '—'} ${f.cause} ${f.state.round.phase} ${momentOfFrame(f)}`
  if (!prev) return head
  const d = diffStates(prev.state, f.state)
  if (!d.length) return `${head} (no change)`
  const body = d.map((c) =>
    c.from === undefined ? `+${c.path}=${clip(c.to!)}`
    : c.to === undefined ? `-${c.path}`
    : `${c.path}: ${clip(c.from)}→${clip(c.to)}`
  ).join(', ')
  return `${head} — ${body}`
}

// CLI entry — guard so the test can import the engine without running it.
if (process.argv[1]?.endsWith('tools/trace.ts')) {
  const frames = readTrace('trace.jsonl')
  for (const f of frames) console.log(timelineLine(f, frames[f.seq - 1]))
}
```

- [ ] **Step 4: Run test**

Run: `node --test tools/trace.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/trace.ts tools/trace.test.ts
git commit -m "trace: the timeline — one line per transition, diffs not dumps"
```

---

### Task 4: CLI filters — `--full`, `--watch`, `--moment`, `--since/--until`, `--round`

**Files:**
- Modify: `tools/trace.ts` (CLI entry section only; engine untouched)
- Test: `tools/trace.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: `filterFrames(frames: Frame[], opts: FilterOpts): Frame[]` where `type FilterOpts = { since?: number; until?: number; moment?: string; watch?: string[] }`, and `roundLines(frames: Frame[]): string[]`.

Behavior:
- `--full N`: print `JSON.stringify(frames[N].state, null, 2)` and exit — bypasses the timeline.
- `--watch a.b,c.d`: only frames whose diff touches one of those exact leaf paths; line shows only those changes.
- `--moment verdict:hold`: only frames whose `momentOfFrame` equals it.
- `--since N` / `--until N`: inclusive seq range.
- `--round`: one line per round. A round opens on `cause === 'host:arm'`; the line collects the final order at `settle` (names with deltaMs), each `host:correct`/`host:wrong` with the score diff, and prints on the next `host:arm` or end of file. Format: `round 3 $400 — Ada@0, Bo@140 → correct Ada (+400)`. Rounds nobody buzzed end `→ passed` when a `host:next` closes them with no settle in between. ponytail: built from causes, not a state walk — a cause string change in hub.ts silently degrades this view, and the test below is the tripwire.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { filterFrames, roundLines } from './trace.ts'

const frame = (seq: number, cause: string, phase: string, order: unknown[] = [], scores = {}): Frame =>
  ({ seq, t: 1000 + seq * 100, cause, state: { round: { phase, armedAt: 900, order }, players: [], scores, game: { id: 'trivia' } } }) as never

test('filterFrames applies since/until and watch', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'ada' }]),
    frame(2, 'settle', 'LOCKED', [{ playerId: 'ada' }], { ada: 0 }),
  ]
  assert.deepEqual(filterFrames(frames, { since: 1 }).map((f) => f.seq), [1, 2])
  assert.deepEqual(filterFrames(frames, { until: 1 }).map((f) => f.seq), [0, 1])
  // watch keeps only frames where that leaf moved
  assert.deepEqual(filterFrames(frames, { watch: ['scores.ada'] }).map((f) => f.seq), [2])
  assert.deepEqual(filterFrames(frames, { watch: ['round.phase'] }).map((f) => f.seq), [1, 2])
})

test('roundLines collapses a buzzed round to one line', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }]),
    frame(2, 'settle', 'LOCKED', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }], { ada: 0 }),
    frame(3, 'host:correct', 'LOCKED', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }], { ada: 400 }),
    frame(4, 'host:next', 'IDLE'),
  ]
  const lines = roundLines(frames)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /Ada@0/)
  assert.match(lines[0], /correct.*\+400/)
})

test('roundLines marks an unbuzzed round as passed', () => {
  const frames = [frame(0, 'host:arm', 'ARMED'), frame(1, 'host:next', 'IDLE')]
  assert.match(roundLines(frames)[0], /passed/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/trace.test.ts`
Expected: FAIL — `filterFrames is not a function`

- [ ] **Step 3: Implement**

In `tools/trace.ts`, add:

```ts
export type FilterOpts = { since?: number; until?: number; moment?: string; watch?: string[] }

export function filterFrames(frames: Frame[], opts: FilterOpts): Frame[] {
  return frames.filter((f, i) => {
    if (opts.since !== undefined && f.seq < opts.since) return false
    if (opts.until !== undefined && f.seq > opts.until) return false
    if (opts.moment !== undefined && momentOfFrame(f) !== opts.moment) return false
    if (opts.watch) {
      const prev = frames[i - 1]
      if (!prev) return false
      if (!diffStates(prev.state, f.state).some((c) => opts.watch!.includes(c.path))) return false
    }
    return true
  })
}

export function roundLines(frames: Frame[]): string[] {
  const lines: string[] = []
  let cur: { value: number; order: { name: string; deltaMs: number }[]; verdicts: string[]; buzzed: boolean } | undefined
  const flush = () => {
    if (!cur) return
    const order = cur.order.map((b) => `${b.name}@${b.deltaMs}`).join(', ') || '—'
    lines.push(`round $${cur.value} — ${order} → ${cur.buzzed ? cur.verdicts.join(' then ') || 'unjudged' : 'passed'}`)
    cur = undefined
  }
  for (const f of frames) {
    if (f.cause === 'host:arm') { flush(); cur = { value: f.state.round.value, order: [], verdicts: [], buzzed: false } }
    if (!cur) continue
    if (f.cause === 'settle') { cur.buzzed = true; cur.order = f.state.round.order }
    if (f.cause === 'host:correct' || f.cause === 'host:wrong') {
      const prev = frames[f.seq - 1]
      const delta = diffStates(prev.state, f.state).find((c) => c.path.startsWith('scores.'))
      const name = f.state.round.order[0]?.name ?? '?'
      cur.verdicts.push(`${f.cause === 'host:correct' ? 'correct' : 'wrong'} ${name} (${delta ? `${+JSON.parse(delta.to!) - +JSON.parse(delta.from!) >= 0 ? '+' : ''}${+JSON.parse(delta.to!) - +JSON.parse(delta.from!)}` : '?'})`)
    }
    if (f.cause === 'host:next') flush()
  }
  flush()
  return lines
}
```

Replace the CLI entry with flag parsing:

```ts
if (process.argv[1]?.endsWith('tools/trace.ts')) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? undefined : args[i + 1]
  }
  const frames = readTrace(flag('file') ?? 'trace.jsonl')
  const full = flag('full')
  if (full !== undefined) {
    console.log(JSON.stringify(frames[+full]?.state ?? null, null, 2))
    process.exit(0)
  }
  if (args.includes('--round')) {
    for (const l of roundLines(frames)) console.log(l)
    process.exit(0)
  }
  const opts: FilterOpts = {
    since: flag('since') !== undefined ? +flag('since')! : undefined,
    until: flag('until') !== undefined ? +flag('until')! : undefined,
    moment: flag('moment'),
    watch: flag('watch')?.split(','),
  }
  const shown = filterFrames(frames, opts)
  for (const f of shown) console.log(timelineLine(f, frames[f.seq - 1]))
}
```

(`--watch` filtering the *displayed* changes to watched paths only: pass the watch list into a `timelineLine` third param if desired — ponytail: full diff under a watched frame is acceptable; add the param only if it reads noisy in practice.)

- [ ] **Step 4: Run tests**

Run: `node --test tools/trace.test.ts`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add tools/trace.ts tools/trace.test.ts
git commit -m "trace: drill-down — watch a leaf, pick a moment, collapse a game"
```

---

### Task 5: Wiring and docs — env flag, npm script, gitignore, CLAUDE.md

**Files:**
- Modify: `server/index.ts` (find where `new Hub(` is constructed; pass `tracePath`)
- Modify: `package.json` (scripts)
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Composition root**

In `server/index.ts`, at the `new Hub(` call add:

```ts
    // The tap is one investigation per boot; TRACE=1 turns it on.
    tracePath: process.env.TRACE ? 'trace.jsonl' : undefined,
```

- [ ] **Step 2: npm script + gitignore**

`package.json` scripts, beside `probe`:

```json
    "trace": "node tools/trace.ts",
```

`.gitignore`, beside `state.json`:

```
trace.jsonl
```

- [ ] **Step 3: CLAUDE.md**

Commands block, after the probe line:

```bash
npm run trace               # diff timeline of a TRACE=1 run: --full N, --watch path, --moment X, --round
```

Verifying section, one short paragraph after the probe description: the trace exists so an agent can ask "how did the room get here" without reading snapshots — `TRACE=1 npm start`, drive the bug with probe, then `npm run trace -- --watch round.held` (or whatever leaf is lying).

- [ ] **Step 4: Verify end-to-end (manual)**

```bash
TRACE=1 npm start &        # NO_OPEN=1 too if headless
npm run probe -- join:Ada,Bo value:400 arm buzz:Ada@0,Bo@140 correct
npm run trace
npm run trace -- --round
npm run trace -- --watch scores.Ada
npm run trace -- --full 3
kill %1
```

Expected: the timeline shows join/value/arm/buzz/settle/correct frames with diffs; `--round` prints one line `… Ada@0, Bo@140 → correct Ada (+400)`; `--watch` prints only the correct frame; `--full 3` prints that frame's whole state.

- [ ] **Step 5: Full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add server/index.ts package.json .gitignore CLAUDE.md
git commit -m "trace: TRACE=1 records, npm run trace reads"
```

---

## Self-review notes

- Spec coverage: tap (T1–T2), CLI timeline + all four drill-downs (T3–T4), TRACE=1/gitignore/docs (T5), testing (per-task + T5 manual). The `--moment` filter is in T4's `filterFrames` and exercised implicitly — if a dedicated test is wanted, it's one more `assert.deepEqual` line in the filterFrames test.
- Verified-against-repo: `changed()` funnel and its 9 call sites, `HubOpts` shape, `momentOf` signature, `newState()` / `hub.send(conn, msg)` entry points, `Round.value`, test idiom.
