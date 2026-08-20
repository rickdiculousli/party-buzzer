# One Ladder Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the three remaining sites where two authorities answer the same question in different words.

**Architecture:** One new pure shared module (`shared/legality.ts`) that both the server and the host surfaces call; one field moved into an existing projection (`phoneOf`); one pair of liveness flags replaced by composed `AbortSignal`s inside `server/reader.ts`.

**Tech Stack:** Node 26.7.0 native TypeScript (no server build step), Preact, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-20-one-ladder-audit-design.md`

## Global Constraints

- Node 26.7.0, pinned via mise. Relative imports carry `.ts` extensions. No `enum`, no `namespace`, no constructor parameter properties.
- Tests use `node:test` and `node:assert/strict` only.
- Runtime deps are exactly `ws` and `qrcode`; client is `preact`. Add none.
- `npm start` serves `dist/`. Any client change needs `npm run build` before it is visible on a real surface.
- `npm test` globs five directories. Never verify with `node --test server/` alone.
- Full check before every commit: `npm test && npm run typecheck`.
- Content and identity, never appearance. A refusal is a code; the surface owns the words.
- Deliberate corner-cuts carry a `ponytail:` comment naming the ceiling.

---

### Task 1: The phone gets one ladder

Deletes `client/Player.tsx:151`, the second derivation of "this phone is the one answering".

**Files:**
- Modify: `shared/wall.ts` — `Mine` (line 308), `Phone` (line 307), `phoneOf` (line 347)
- Modify: `client/Player.tsx:151`, `:268`
- Test: `shared/wall.test.ts`

**Interfaces:**
- Produces: `Mine.judging: boolean`, `Phone.talk: boolean`

- [ ] **Step 1: Write two failing tests in `shared/wall.test.ts`**

One: leader locked in with `judging: true` → `phoneOf(...).talk === true`. Two: the same `Mine` but `frozen: true` → `talk === false` and `mood === 'barred'` (the improvement the spec claims — the old expression never asked).

- [ ] **Step 2: Run and confirm both fail**

`node --test shared/wall.test.ts` — expect a type error on `judging`/`talk`.

- [ ] **Step 3: Add the fields**

`judging: boolean` on `Mine` with a doc comment saying it is `!!round.judge`, the judge's open window. `talk: boolean` on `Phone`.

- [ ] **Step 4: Return `talk` from every `phoneOf` branch**

Only the `f.won && shut` branch returns `f.judging`; the other eight return `false`. Do it by hand, not with a spread — the point of the exercise is that each branch states its answer.

- [ ] **Step 5: Run and confirm both pass**

`node --test shared/wall.test.ts`

- [ ] **Step 6: Wire the phone**

Delete `client/Player.tsx:151`. Add `talk` to the destructuring of `phoneOf`'s result (currently `const { label, sub, mood }`), pass `judging: !!round?.judge` in the `Mine` literal, and leave `:268`'s `{talk ? …}` reading the new binding.

- [ ] **Step 7: Full check and commit**

```bash
npm test && npm run typecheck && npm run build
git add shared/wall.ts shared/wall.test.ts client/Player.tsx
git commit -m "phone: the mic mounts off the ladder that already decides who is answering"
```

---

### Task 2: `shared/legality.ts`, the table and its tests

The module alone, with nothing calling it yet. Split from Task 3 so a reviewer can reject the vocabulary without rejecting the wiring.

**Files:**
- Create: `shared/legality.ts`
- Create: `shared/legality.test.ts`

**Interfaces:**
- Consumes: `State`, `HostAction` from `shared/protocol.ts`; `eligible` is in `server/duel.ts` and must **not** be imported (server-side; see Step 3).
- Produces: `type Refusal`, `function refuses(state: State, action: HostAction): Refusal | null`

- [ ] **Step 1: Enumerate the codes from the guards being replaced**

Read `server/state.ts` lines 153, 172, 265, 359, 378, 396, 424, 435 and `client/DuelPanel.tsx:9` (`closeBlockReason`). Two guards refusing for the same reason share one code. Expect roughly: `not-idle`, `no-leader`, `already-scored`, `nothing-held`, `no-duel`, `duel-seated`, `unknown-mode`, `no-blocks`, plus whatever `closeBlockReason` distinguishes.

- [ ] **Step 2: Write the failing test file**

One case per code, each driving a `State` from `newState()` into the refusing shape and asserting the exact code back. Plus one case asserting `refuses` returns `null` for each action in its legal shape.

- [ ] **Step 3: Write `refuses`**

The tricky shape — the totality check is the point, so it must be a `switch` on `action.a` with no `default`:

```ts
export function refuses(s: State, a: HostAction): Refusal | null {
  const r = s.round
  // Annotated, not inferred: without it this widens to `string | null` and the
  // return type stops checking anything.
  const idle: Refusal | null = r.phase === 'IDLE' ? null : 'not-idle'
  switch (a.a) {
    case 'arm':
      return idle
    case 'correct':
    case 'wrong':
      if (r.phase !== 'LOCKED' || !r.order[0]) return 'no-leader'
      return r.award && !isPenalty(r.award) ? 'already-scored' : null
    case 'rebound':
      return r.held ? null : 'nothing-held'
    // … one case per HostAction kind, no default
  }
}
```

`shared/` may not import from `server/`, so any duel-eligibility rule the table needs is re-expressed here over `State` or left at its call site as a lookup. Prefer leaving it: `too-few-eligible` is a hint, not a legality rule, and the server refusing it is already covered by `no-duel`/`duel-seated`.

- [ ] **Step 4: Run and confirm pass**

`node --test shared/legality.test.ts`

- [ ] **Step 5: Prove the totality check bites**

Comment out one `case`, run `npm run typecheck`, confirm a `TS2366` (not all code paths return a value), restore it. This is a manual check with no artifact — it is what the whole module is for, so confirm it once by hand.

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add shared/legality.ts shared/legality.test.ts
git commit -m "legality: one table says when a host action is allowed"
```

---

### Task 3: The server refuses from the table

**Files:**
- Modify: `server/state.ts` — `applyHostAction`, guards at 153, 172, 265, 359, 378, 396, 424, 435
- Test: `server/state.test.ts`

**Interfaces:**
- Consumes: `refuses`, `Refusal` from `shared/legality.ts`

- [ ] **Step 1: Write the failing parity test in `server/state.test.ts`**

The test that gives the table teeth. For every `HostAction` kind, across a handful of representative states (fresh, ARMED, LOCKED with a leader, a held miss, a duel open, a duel seated): when `refuses(state, action) === null`, applying it must change the state. Compare `structuredClone` before against after with `assert.notDeepEqual`.

Name the actions explicitly in an array in the test — do not derive them, or a `HostAction` added later silently drops out of the parity check.

- [ ] **Step 2: Run and confirm it fails**

`node --test server/state.test.ts` — it should fail on at least one action whose server guard and table already disagree. If it passes on the first run, the test is not exercising enough states; add the missing one.

- [ ] **Step 3: Refuse once at the top**

Add `if (refuses(state, action)) return` as the first line of `applyHostAction`, before the `switch`.

- [ ] **Step 4: Delete the eight duplicated guards**

Lines 153, 172, 265, 359, 378, 396, 424, 435. Leave `if (!duel || duel.seated) return` at 377 **only** if the case needs `duel` as a value afterwards — a lookup stays, a precondition goes.

- [ ] **Step 5: Run and confirm pass**

`npm test` — `server/state.test.ts`, `server/duel.test.ts`, `server/integration.test.ts` and `server/game-modes.integration.test.ts` all exercise these guards.

- [ ] **Step 6: Commit**

```bash
npm test && npm run typecheck
git add server/state.ts server/state.test.ts
git commit -m "state: the guards come off, the table refuses"
```

---

### Task 4: The host surfaces disable from the table

**Files:**
- Modify: `client/Host.tsx` (`:201`, `:210`, `:218`, `:225`, `:231`)
- Modify: `client/HostSetup.tsx` (`:37`, `:44`, `:81`)
- Modify: `client/SetlistPanel.tsx` (`idle` at `:25`, nine `disabled={!idle}` sites, `:73`, `:219`, `:227`)
- Modify: `client/DuelPanel.tsx` (`closeBlockReason` at `:9`, `idle` at `:43`, `:71`, `:143`, `:153`)

**Interfaces:**
- Consumes: `refuses`, `Refusal`
- Produces: `REFUSAL_TEXT: Record<Refusal, string>` — put it in `client/ui.ts`, which all four surfaces already import

- [ ] **Step 1: Add `REFUSAL_TEXT` to `client/ui.ts`**

A `Record<Refusal, string>`, so a new code fails to typecheck until it has words. Seed it with `closeBlockReason`'s existing sentences — they are the prose that already survived a game night.

- [ ] **Step 2: Replace the `disabled` expressions**

`disabled={!!refuses(state, { a: 'arm' })}` and so on. Where the button had no explanation, show one: `title={REFUSAL_TEXT[code]}` — the reason existed all along and was being thrown away.

- [ ] **Step 3: Delete `closeBlockReason` and both `idle` locals**

`client/DuelPanel.tsx:9` and `:43`, `client/SetlistPanel.tsx:25`.

- [ ] **Step 4: Keep the two that are not legality**

`disabled={!saveAs.trim() || blocks.length === 0}` (`SetlistPanel:93`) and `disabled={pick.length !== 2 || pickSameTeam}` (`DuelPanel:168`) are about the form's own contents, not about whether the room permits the action. Leave both. `Host.tsx`'s `judgeable` also stays — it is already derived from `momentOf`, so it is a consumer of the ladder, not a rival to it.

- [ ] **Step 5: Typecheck, build, commit**

```bash
npm test && npm run typecheck && npm run build
git add client/ui.ts client/Host.tsx client/HostSetup.tsx client/SetlistPanel.tsx client/DuelPanel.tsx
git commit -m "host: the desk greys out what the server would refuse, and says why"
```

- [ ] **Step 6: Hand back for a look at the desk**

The host panel has no automated coverage of button state. Say so, and ask for a pass over `/host` in each of: idle, armed, locked with a leader, a held miss, a duel open. What to watch for: a control greyed with no tooltip, or one live that does nothing when pressed.

---

### Task 5: The reader's two scopes become two signals

Last, and the only task whose real verification is a walkthrough.

**Files:**
- Modify: `server/reader.ts` — `running` (101), `start` (268–286), `stop` (300–302), `run` (353), `stillMine` (394), the read loop (388–500), `waitOutBuzz` (638), `until` (671)
- Test: `server/reader.test.ts`, `server/reader.joined.test.ts` — **must pass unmodified**

- [ ] **Step 1: Add the session controller**

`private session = new AbortController()`. `start()` replaces it with a fresh one (an aborted controller never un-aborts); `stop()` calls `this.session.abort()`. Keep `this.running` for now — `publish` reads it at `:325` and other loops at `:539`, `:596` still use it.

- [ ] **Step 2: Add `watch`**

The tricky shape — it must fire off the existing `waiters` set and must not leak a waiter when the signal is never needed:

```ts
/** A signal that aborts the moment `ok()` stops being true. */
private watch(ok: () => boolean): AbortSignal {
  const c = new AbortController()
  const check = () => {
    if (ok()) return
    this.waiters.delete(check)
    c.abort()
  }
  this.waiters.add(check)
  c.signal.addEventListener('abort', () => this.waiters.delete(check), { once: true })
  return c.signal
}
```

- [ ] **Step 3: Compose the question signal**

In the read loop, right after `stillMine` is defined: `const sig = AbortSignal.any([this.session.signal, this.watch(stillMine)])`. Keep `stillMine` itself — it is the predicate, and its comment about `pushed === 0` is load-bearing.

- [ ] **Step 4: Make the awaits throw**

`until(ok, dwellMs, sig)`, `sleep(ms, sig)` and `speakWhole(..., sig)` each call `sig.throwIfAborted()` on resolve. `until` must also `clearTimeout` and drop its waiter on abort, or a stopped reader leaves timers behind.

- [ ] **Step 5: Catch once**

Wrap the per-question body in `run()` with `try { … } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) throw e; return }`. An abort is the normal way a question ends; it must not log.

- [ ] **Step 6: Delete the manual checks**

The `!this.running` / `!stillMine()` tests at 358, 367, 377, 414, 445, 448 (the `for` condition), 449, 456, and the `this.running` terms at 483, 488, 495, 638, 643, 647, 651. Leave `:269`'s re-entry guard in `start()` and the loops at `:539` and `:596` unless they are inside the question's scope.

- [ ] **Step 7: Run the reader tests unmodified**

```bash
node --test server/reader.test.ts server/reader.joined.test.ts
```

If either fails, **stop and report** rather than updating the test. The spec calls a failure here the signal that the conversion changed behaviour.

- [ ] **Step 8: Full check and commit**

```bash
npm test && npm run typecheck
git add server/reader.ts
git commit -m "reader: one signal per scope, and the awaits do the remembering"
```

- [ ] **Step 9: Hand back for the walkthroughs**

`npm run walk-read` and `npm run walk-packs` are the owner's to run. Say what to listen for: the box going quiet mid-question, a fragment landing late, or the pack failing to run out at the end. No test hears any of those.

---

## Notes for the executor

- Tasks 1–4 are covered by `npm test`. Task 5 is not, in the way that matters.
- Task 4 Step 6 and Task 5 Step 9 end in a hand-back, not a green suite. Do not mark the plan complete without them.
- If Task 2's totality check does not produce `TS2366` when a case is removed, the `switch` has a `default` or the return type is too loose. Fix that before continuing — it is the only thing making this structural rather than tidy.
