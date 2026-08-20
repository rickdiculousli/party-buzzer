# One ladder, three more times

An audit of the repo for the defect class `shared/wall.ts` was built to kill,
and the three remaining instances of it.

## What the audit found

The prompt was to look for nested and combinatorial conditionals. There are
almost none. One file has branches indented past ten columns
(`server/reader.ts`, thirteen of them); two files have any condition with three
or more logical operators. There is no general "reduce the ifs" pass worth
doing, and this document does not propose one.

What there is instead is three more instances of the specific thing that cost
two sessions in August: **two authorities answering the same question in
different words.** Not a wrong expression anywhere — two expressions, either
one defensible alone, disagreeing in a state nobody enumerated.

### 1. Action legality is stated twice, across the client/server line

`applyHostAction` guards eight cases with `if (round.phase !== 'IDLE') return`.
The host surfaces independently restate the same rule in roughly fourteen
places: `disabled={!idle}` (SetlistPanel, ×11), `disabled={round.phase !==
'IDLE'}` (HostSetup, ×3), and compound forms in `Host.tsx` and `DuelPanel.tsx`
(`!judgeable`, `!!closeReason`, `!idle || eligible.length < 2 ||
!!randomBlocked`).

Nothing checks that the two agree. A button live where the server will silently
`return` is a dead click with no feedback; a button greyed out where the server
would have accepted is a feature nobody can reach. This is `momentOf` and
`middleOf` again with a network hop in the middle, and the same thing is true of
it: neither side is wrong, and every bug will be the pair disagreeing.

### 2. `client/Player.tsx:151` is a second ladder beside `phoneOf`

```ts
const talk = !!mine && mine.deltaMs === 0 && round?.phase === 'LOCKED' && !!round?.judge
```

This re-derives "this phone is the one answering" from raw state, while
`phoneOf` answers the same question five lines later as `won && shut`. Two
expressions, different words, no stated relationship. The microphone's entire
lifetime hangs off the one that is not the ladder.

### 3. `server/reader.ts` re-checks two liveness flags eighteen times

`this.running` (the read session) and `stillMine()` (this particular question)
are tested at roughly eighteen points across the read loop, in four
combinations, including as a `for` condition and inside two callbacks. They are
not redundant — they are genuinely two different scopes — but every `await` is a
place a stale question can wake up and write fragments into a live one, and the
protection is that somebody remembered to test both.

The root cause is narrow: `until()` returns `void`. It already resolves when the
reader stops, but a resolved `await` does not say *why* it resolved, so every
caller has to re-ask.

### Deliberately not in scope

- `shared/wall.ts` and `phoneOf` are the good shape already.
- `applyHostAction`'s action `switch` is a `switch` on a discriminated union.
  That is the pattern, not a smell.
- The reader's per-pack bookkeeping (`pos`, `loaded`, `ready`, `pack`) could be
  one structure per pack. It is not where any bug was. YAGNI.
- The reader's nesting. See §2 below.
- `buzzBlockReason` stays where it is. It answers "may this *player* buzz",
  which is a different question from "may the host do this"; folding them
  because both return reason-or-null would be shape-matching, not consolidating.

## §1 — `shared/legality.ts`

```ts
export type Refusal =
  | 'not-idle' | 'no-leader' | 'already-scored' | 'nothing-held'
  | 'duel-seated' | 'no-duel' | 'too-few-eligible' | 'no-second-team'

export function refuses(state: State, action: HostAction): Refusal | null
```

The codes above are the ones the audit found; the final union is whatever the
guards being replaced actually say, enumerated during implementation. A code
earns its place by being a refusal some surface needs to explain — two guards
that refuse for the same reason share one code rather than splitting on which
line they came from.

One exhaustive `switch` over `action.a`, **no `default`**, so a new `HostAction`
does not compile until it has said when it is legal. That is `middleOf`'s
totality trick pointed at a second question, and it is the part that makes the
class structural rather than remembered.

This is not a new idiom. The repo invented reason-or-null twice already and gave
it no home: `buzzBlockReason` in `server/state.ts:75` (returns a code) and
`closeBlockReason` in `client/DuelPanel.tsx:9` (returns prose). `refuses` is the
third instance, which is the bar for extracting one.

**Server.** `applyHostAction` opens with `if (refuses(state, action)) return`,
and the per-case phase guards go away. Guards that are *lookups* rather than
preconditions (`if (!player) return`, destructuring a rule the case then needs)
stay — they are fetching a value, not ruling on legality.

**Client.** The host surfaces call the same function:
`disabled={!!refuses(state, a)}`. A `REFUSAL_TEXT: Record<Refusal, string>` in
the host client maps code to prose, which is where `closeBlockReason`'s existing
sentences land. Identity in `shared`, words on the surface — the same split as
`tone: 'penalised'` and the stylesheet.

**The test that gives it teeth.** `shared/legality.test.ts` for the table
itself, plus a parity test in `server/state.test.ts` modelled on the wall-parity
test in `hub.test.ts`: for every `HostAction` kind across representative states,
`refuses(...) === null` implies `applyHostAction` actually changed something.
That is what stops the table and the server drifting, which is the failure this
whole document is about.

## §2 — The reader's two scopes become two signals

```
session   AbortController, created in start(), aborted in stop()
question  AbortSignal.any([session.signal, watch(stillMine)])
```

`watch(ok)` aborts a controller the moment a predicate goes false, driven off
`this.waiters` — the state-change callback set `until()` already uses, so it
adds no new notification path. `AbortSignal.any` is stdlib on Node 26.

`until`, `sleep` and `speakWhole` take the signal and call
`signal.throwIfAborted()` themselves, with one `catch` for `AbortError` at the
top of the read loop. This is the point of the section: the check moves inside
the thing that was already being awaited, so there is no site left at which
forgetting is possible. The cheaper version — `if (sig.aborted) return` at each
site — is one flag instead of two and still eighteen places to remember, and is
not what is being built.

**Pause is untouched.** It is a separate concept (`ReadingState.paused`, and the
`playback.stop()` on line 115). A pause re-reads the fragment from its start
rather than abandoning the question, so it must not abort, and does not.

**Nesting is untouched.** Lifting the inner reveal loop out would drop the depth
but means moving code whose timing is tuned by ear; the risk is a change in when
fragments land that no test catches and only a walkthrough hears. The signals
remove the class of bug; the depth is a long procedure, which is what reading a
question aloud actually is.

**Blast radius.** `server/reader.ts` only. No signature changes outside it.
`server/reader.test.ts` and `server/reader.joined.test.ts` must pass unchanged —
if they do not, the conversion changed behaviour, and that is the signal to stop
rather than to update the test.

## §3 — The phone gets one ladder

`Mine` gains `judging: boolean` (`!!round.judge` — the judge's window is open).
`Phone` gains `talk: boolean`, returned from inside the branch that has already
decided this phone is the one answering:

```ts
if (f.won && shut) return { label: 'You’re up', sub: 'Answer it', mood: 'first', talk: f.judging }
```

Every other branch returns `talk: false`. `client/Player.tsx:151` is deleted and
`<Talk>` mounts on `phone.talk`.

The mic cannot hang off a `Moment` instead: `answer:judging` is gated on
`!local.settled`, and `Player.tsx` passes `settled: true` unconditionally, so
that moment never occurs on a phone. `judging` is a fact about state, and it
enters through `Mine` like every other fact the phone knows about itself.

Behaviourally equivalent to the current expression, with one strict improvement:
`frozen`, `barred`, `dead` and `spectator` rank above "You're up" in the ladder,
so a leader who is somehow also frozen no longer gets a live microphone. The old
expression did not ask.

## Sequencing

Smallest first, each landing verified before the next starts.

1. **§3, the phone.** Twenty minutes. Covered by `npm test`.
2. **§1, legality.** The interface change. Covered by `npm test`, including the
   new parity test.
3. **§2, the reader.** Covered by the reader tests for correctness and by
   `npm run walk-read` / `npm run walk-packs` for the thing tests cannot hear.
   The failure mode this could introduce is the box going quiet mid-question.

## What this is not

It is not a refactor of the codebase. Three named sites, one shared module, one
deleted line, one control-flow conversion. Everything else the audit looked at
either was already the good shape or had never produced a bug, and both of those
are reasons to leave code alone.
