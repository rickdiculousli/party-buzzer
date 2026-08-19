# The wall boundary

A single shared answer to "where is this question, and what may be shown right
now" — replacing six booleans and a seven-branch ternary on the board.

## The problem

Every display bug this month has been the same shape: a condition that matched
in a state nobody was thinking about, because the state before it had stopped
matching. Three landed in one session — a miss's transcript sitting over the
resumed clue, the same transcript re-shown above the rebounder's name, the clue
flashing back onto the wall for the length of the transcript's typing
animation. Each was fixed by adding a term to an expression.

The board decides what to show from six booleans — `verdict`, `showAward`,
`missing`, `answering`, `armed`, `reading` — spread across three JSX blocks
(`board__above`, `board__mid`, `board__below`) that each re-derive overlapping
parts of the same question. That is 2⁶ combinations, of which perhaps a dozen
mean anything, and nothing anywhere says which dozen.

The phone does not have this problem. `buzzerFace` in `client/ui.ts` is pure,
priority-ordered and tested by a walk through one whole question, and it stopped
generating bugs. The board never got one.

## The decision

`shared/wall.ts` exports one vocabulary and two projections of it.

```ts
export function momentOf(state: State, local: Local): Moment   // every surface
export function wallOf(state: State, local: Local): Wall       // the big screen
export function phoneOf(moment: Moment, mine: Mine): Phone     // the small one

type Local = { open: boolean; settled: boolean; retired: boolean }
```

`open` joined `Local` during implementation. Whether the buzzers have actually
opened is a countdown against `armedAt` on the client's synced clock, so
reading it here would mean reading the clock — the one thing rule 2 forbids.
Both surfaces already compute it (`useOpen`), so passing it costs nothing.

`Moment` is the shared notion — one word for where a question is. `Wall` and
`Phone` are what each surface renders, already decided. Neither surface keeps
conditions of its own.

Two rules govern the module, and they belong in its doc comment:

1. **Content and identity, never appearance.** A tone is `'penalised'`, not
   `'red'`. The stylesheet maps it. If `shared/` learns what brass is, the
   boundary has drifted.
2. **It never reads the clock and never reads the DOM.** Everything
   time-dependent arrives in `local`. That is what keeps it runnable under
   `node:test` with no browser.

### Why `Wall`

The repo already uses the word, constantly, and only ever for this: the miss
holds the wall, the clue resumes on a clean wall, the room reads the wall. It
names no position in a sequence, which `stage` and `scene` both do — and this
codebase runs real sequences called blocks and phases, so an ordinal reading
would be a fair one. `Phone` is its parallel: two surfaces, two physical
objects in the room. Should the host desk ever need its own projection it is
`Desk`, already the repo's word, but it does not need one today.

### Why a string union

`enum` is unavailable — server code is native TypeScript, Node strips the
types, and an enum has a runtime body that nothing is left to emit. Beyond
that: thirteen named states are exhaustible by a `switch` that errors when a
fourteenth appears, where six booleans are not; a bare string stays a `Record`
key and prints readably in a test failure; and it is JSON-native, so it costs
nothing if it ever has to cross the wire.

## The vocabulary

Thirteen moments in five families. The union is written in priority order —
`momentOf` returns the first that matches, and that ordering is the
load-bearing part. It follows the order the board's middle band already uses
today (`Board.tsx:426-500`), which is the one arrangement known to be right.

```ts
export type Moment =
  | 'answer:judging'
  | 'verdict:hold'    | 'answer:locked'
  | 'verdict:penalty' | 'verdict:award'
  | 'duel:nominating' | 'duel:dead'  | 'duel:faceoff'
  | 'buzz:collecting' | 'buzz:open'  | 'buzz:arming'
  | 'idle:ready'      | 'idle:welcome'
```

**`verdict:hold` must sit above `answer:locked`,** which an earlier draft of
this document got backwards. A hold keeps the phase at `LOCKED` — that is how
it shuts the buzzers — so `answer:locked` first would swallow it and a hold
could never be reached. The board escaped this by testing `order[0]`, which is
emptied during a hold; nothing here may do that, because `order` is redacted.

| Moment | True when | On the wall | Left by |
|---|---|---|---|
| `answer:judging` | a transcript is up and has not settled | Speaker's name, neutral, transcript typing above | `Spoken` finishes typing and holds `--verdict-hold` |
| `verdict:hold` | `round.held` | The miss: transcript, stamp, penalised name. Buzzers shut | The reader's `rebound`, after `reboundSec` |
| `answer:locked` | `LOCKED` with a leader | Leader's name, timeline below | A verdict lands |
| `verdict:penalty` | award up, settled, negative, not held | Stamp, penalised tone, name it cost | The `--penalty-dwell` retire |
| `verdict:award` | award up, settled, positive | Stamp and revealed answer, over whatever the middle band already held | The next arm |
| `duel:nominating` | `duel && !duel.seated` | The pool, a column per side in teams | The host closes the window |
| `duel:dead` | `candidates` is `[]`, not absent | "Both missed — waiting for the host" | The host resets or moves on |
| `duel:faceoff` | a pair is seated, not yet armed | "Ada vs Eve" | The host arms |
| `buzz:collecting` | `COLLECTING` | Leader, once the hub reveals at 150ms | The window closes at `COLLECT_MS` |
| `buzz:open` | `ARMED`, past `armedAt` | "Buzz" — or the clue, if the box is reading | The first press |
| `buzz:arming` | `ARMED`, before `armedAt` | "Stand by", filament running | `ARM_LEAD_MS` elapses |
| `idle:ready` | `IDLE`, the night has started | "Ready" | The host arms |
| `idle:welcome` | `IDLE`, never armed, every score 0 | Big QR, welcome bed running | The first arm, for good |

The families are not themselves contiguous in priority by accident —
`verdict:` sits between `answer:` and `duel:` because a result outranks a new
nomination window, and `duel:faceoff` sits below `duel:dead` because a dead
duel is still seated. Reordering within a family is safe; reordering across
one is a behaviour change.

Four of these carry more than a row's worth.

**`idle:welcome` and `idle:ready` are two moments for one reason.** "The round
is idle" is also true between every pair of questions, and the welcome bed
swelling back up for four seconds each time the host reaches for the next card
would be unbearable by round three.

**`buzz:arming` and `buzz:open` are the `ARM_LEAD_MS` lead.** Every surface
counts down to the same `armedAt` on its own synced clock and the hub drops
buzzes arriving before it, so `arming` is a real state with a real rule: live,
but nobody may press.

**`buzz:collecting` before the 150ms reveal is deliberately indistinguishable
from `buzz:open`.** The hub holds the first packet back, `order` is empty, and
the wall still says "Buzz". The moment differs; the `Wall` does not. That is
the redaction rule surfacing in the vocabulary — the room learns nothing the
hub has not published.

**`answer:judging` outranks `verdict:hold`,** and this is the ordering that
retires the bug class. A spoken miss publishes transcript, award and `held` in a
single broadcast. The room must read the transcript before the result, so
`judging` holds until `Spoken` settles and `hold` takes the rest of the
shut-buzzer beat.

`reading` is not a moment. Whether the box is driving is orthogonal — the room
can be `buzz:open` with a clue on the wall or with "Buzz" on it. It stays a
field on `State` that `wallOf` consults. Making it a moment would double the
list.

## What the wall may show

```ts
export type Wall = {
  moment: Moment
  hero: { name: string; tone: 'answering' | 'penalised' } | null
  clue: { whole?: string; shown: string } | null
  nominations: 'solo' | 'teams' | null
  faceoff: [string, string] | null
  call: 'buzz' | 'standby' | 'ready' | 'dead' | null

  transcript: { name: string; text: string; hit: boolean } | null
  award: { name: string; points: number; answer?: string } | null
  timeline: boolean
  filament: boolean
  value: number | null
}
```

**The invariant: exactly one of `hero`, `clue`, `nominations`, `faceoff`,
`call` is non-null.** Those five are the middle band's occupants. The
seven-branch ternary exists only because nothing ever said they were mutually
exclusive; once the type says it, the arrangement that caused three of this
month's bugs cannot be expressed.

The remaining five are the other two bands and may co-occur with the middle
one, which is correct — a miss is legitimately transcript, award and hero at
once.

## What the phone may show

```ts
export type Phone = { label: string; sub: string; mood: Mood }
export type Mood = 'waiting' | 'open' | 'placed' | 'first' | 'barred'
export type Mine = {
  frozen: boolean
  barred: boolean
  spectator: boolean
  finalistNames?: string[]
  won: boolean
  pressed: boolean
  deltaMs?: number
  armed: boolean
  open: boolean
}
```

`buzzerFace`'s eleven parameters become a moment plus nine. Three go — `dead`,
`answering` and `held` — and they were the three the moment names.

`armed` and `open` stay, which an earlier draft assumed they would not. They
are what separates "the buzzers are shut because somebody is answering" from
"a transcript is typing over a rebound that is already open". The phone must
say **Buzz** in the second case, and only the live flags distinguish them —
`answer:judging` spans both.

`mood` today returns CSS class names (`'is-barred'`, `'is-first'`) directly
from `client/ui.ts`. That is precisely the drift rule 1 forbids, so the
migration replaces them with the semantic tokens above and the stylesheet maps
them.

## Redaction parity

`viewFor` (`server/hub.ts:441`) strips `order` down to the player's own entry,
strips `whole` unconditionally, and gates `fragments` and `answer` on
`mirrorFragments`. It keeps `phase`, `armedAt`, `spoken`, `award`, `held`,
`duel` and `candidates` — every field a moment derives from.

**So the phone and the wall compute the same word from different data, and
cannot drift.** Names are the part that cannot be shared, which is why `Wall`
carries them and `Moment` does not: `answer:locked` is true on both surfaces,
but only the wall may know it is Ada.

This forces one correction on the way past. `idle:welcome` cannot key off
`order.length === 0`, which is redacted — a wall that had seen a buzz would say
`idle:ready` while a non-buzzing phone still said `idle:welcome`. It keys off
`armedAt` instead: never armed, no scores. That states the intent better
anyway, since welcome ends at the first arm for good.

## Verification

Three tests, `node:test` and `node:assert/strict`, no DOM.

**The invariant, asserted mechanically.** A helper counting non-null among the
five middle-band fields, failing on anything but one. Called at every step of
the walk below, so a regression is caught by a test nobody had to think to
write.

**One question end to end,** the format `client/ui.test.ts` already uses and
the reason `buzzerFace` stopped generating bugs: arm, open, buzz, lock,
transcript typing, settled, wrong, hold, rebound, clue resumes, second buzz,
correct. Asserting the moment and the `Wall` at each step. Every bug from this
month is one line in that walk.

**Redaction parity.** Server tests already drive `Hub` directly: step a
question and assert `momentOf(hub.state)` equals `momentOf(hub.viewFor(conn))`
at each step. The wall-and-phones guarantee held by a test rather than by care.

## Migration

Each step independently green. No behaviour change is intended anywhere.

1. `shared/wall.ts` and its tests.
2. `client/Player.tsx` — smallest, and its existing `buzzerFace` tests are the
   canary. `Face` disappears; `mood` becomes semantic and `client/style.css`
   maps the five tokens.
3. `client/Host.tsx` — one line. `judgeable` (`Host.tsx:64`) becomes
   `m === 'answer:locked'`. It takes `momentOf` and nothing else; a desk is a
   control surface, not a stage, and building it a projection it does not need
   is the abstraction this document exists to avoid.
4. `client/Board.tsx` — largest. The derivation cluster at lines 341–366 and
   all three bands become a flat read. The two local timers stay on the board
   and become `local`.

## Non-goals

- **No new State fields and no new server timers.** Reveal pacing stays client
  side; `local` is how it reaches the module.
- **No permission table.** `Wall` describes one arrangement directly; a
  separate grid of what each moment permits would be a second artifact to keep
  in sync with the first.
- **No `Desk`.** Host needs `momentOf` only.
- **No CSS renaming.** `board__stage` and its siblings stay. See below.

## Follow-on

The concept is renamed, not the code around it. A separate pass canonises the
repo's overloaded words — see
`2026-08-18-canon-words-design.md`, which this work seeds with the collisions
it turned up.
