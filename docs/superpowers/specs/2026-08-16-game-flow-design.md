# The game flow: a setlist of blocks

An ordered list of blocks — N questions of a mode, optionally as duels — that
the host builds, saves, and runs. It is the driver the duel spec named in its
"Future, deliberately not built" section, and it plugs into exactly the seams
that spec left: `setGame`, `openDuel`, and the round's own lifecycle.

The flow **advises, it does not play**. It applies each block's setup and then
stops; the host still presses Space, C, W and N all night. That single decision
is what keeps `server/reader.ts` untouched — the reader owns `arm` on its own
loop, and two things issuing `arm` is a contention this design never creates.

## Decisions

- A block declares a mode, its options, a question count, an optional round
  value, and an optional duel rule. Nothing else. Teams, mirroring and pack
  selection stay session-level settings the host owns.
- The flow never arms, never scores, and never advances itself past a question
  the host has not finished.
- A question has gone by when the host presses **Next** on a round that was
  actually armed. N is already the "that one's done" gesture.
- The flow lives in `State`, so snapshot, undo and broadcast come free. It is
  saved to and loaded from disk on a button press, so a night's structure
  outlives the session.
- The builder is setup and folds away. The position is play and does not.

## Protocol (`shared/protocol.ts`)

```ts
/** One stretch of the night: N questions of one mode, optionally as duels. */
export type FlowBlock = {
  /** Module id, into the same catalog the host settings form renders from. */
  game: string
  /** Values for that module's option schema; sanitized on apply. */
  options: Record<string, unknown>
  /** Questions in this block. */
  count: number
  /** Round value for the block. Absent = leave whatever the host set. */
  value?: number
  /** Duel rule id, opened before every question in the block. */
  duel?: string
}

export type FlowState = {
  blocks: FlowBlock[]
  /** Index of the running block. Equals blocks.length when the flow is spent. */
  at: number
  /** Questions gone by inside the current block. */
  done: number
}

// State gains:
//   flow?: FlowState
//   flows: string[]   (saved flow filenames on disk; filenames only, like packs)

export type HostAction =
  | ...existing
  /** The builder writes the whole array. One action means one undo step. */
  | { a: 'setFlow'; blocks: FlowBlock[] }
  | { a: 'flowJump'; at: number }
  | { a: 'clearFlow' }
```

`setGame` gains one field:

```ts
| { a: 'setGame'; id: string; options: Record<string, unknown>; keepScores?: boolean }
```

Saving and loading ride the `act` channel beside `selectPack`, because they
touch disk and do not belong in undo history: `saveFlow` (data = name) and
`loadFlow` (data = filename).

**Why `setFlow` and not add/move/remove.** Reordering a block is array work the
client can do; four actions would buy four undo steps for one edit. The whole
array is a few hundred bytes.

## Server

**`server/flow.ts`** is a pure module in the shape of `duel.ts` — it imports
types only, and takes the applier as a parameter rather than importing
`applyHostAction`, which would be a cycle:

```ts
type Apply = (action: HostAction) => void

/** Set up the current block. `fresh` = the block changed, so re-apply the mode. */
export function enterBlock(state: State, apply: Apply, fresh: boolean): void

/** One question has gone by. Rolls over to the next block when count is spent. */
export function advanceFlow(state: State, apply: Apply): void
```

`enterBlock` splits by kind. `game`, `options` and `value` apply only when the
block changes, on a jump, or on first entry. `duel` applies before every
question in the block, because a duel block is a duel per question.

Re-stamping the value every question would fight two things: the host's own
mid-block tweak, and the reader's per-question `setValue` from the pack. Both
are legitimate and neither should lose to a setting the host wrote an hour ago.

`enterBlock` on a spent flow (`at >= blocks.length`) does nothing. The flow sits
at its end rather than clearing itself — the host reads the position off the
board and decides whether to jump back or clear.

**The three host actions.** `setFlow` with a non-empty array replaces
`state.flow`, keeping `at` and `done` if a flow was already running and the
index is still in range, otherwise starting at `0/0` and entering the first
block fresh — editing block 4 mid-block-2 must not restart the night.
`setFlow` with an empty array is `clearFlow`. `flowJump` clamps to
`[0, blocks.length]`, resets `done`, and enters fresh. `clearFlow` deletes
`state.flow` and leaves the mode, the value and any open duel exactly as they
are: clearing the setlist is not a reason to change the game in progress. All
three are refused unless `round.phase === 'IDLE'`, matching `setGame`.

**The advance point** is the existing `next` branch in `applyHostAction`, after
its reset, so `openDuel` sees `phase: 'IDLE'` and a cleared `state.duel`:

```
case 'next':
case 'resetRound':
  ...existing reset, delete state.duel...
  if (action.a === 'next' && round.armedAt > 0) advanceFlow(state, apply)
  return
```

The `armedAt > 0` guard is the whole miscount defence. Double-tapping N sees a
reset round the second time and burns nothing; clearing a stale award the same.
A rebound re-arms through `wrong`, not `arm`, so it never counts twice.
`resetRound` is excluded on purpose: it is the host taking a question back.

**Scores across a block boundary.** `setGame` on a different id clears
`state.scores` — deliberately, since switching a mode mid-session is a fresh
game. A flow crossing from trivia to quizbowl at block 2 would erase the
standings mid-night, which is the worst thing this feature could do. So
`setGame` gains `keepScores`, the flow passes it, and the host's own switch
keeps today's wipe. Items and effects still reset either way: they are
mode-flavoured, and carrying a quizbowl power into a trivia block is not a
thing anyone asked for.

**`server/flows.ts`** mirrors `packs.ts`:

- `listFlows(dir)` — sorted `.json` filenames, ENOENT is a room with no saved
  flows rather than an error, anything else warns.
- `readFlow(dir, name)` — refuses a name that is not its own basename, the same
  traversal guard `loadPack` carries. Validates on the way in: a block naming an
  unregistered module or an unknown duel rule is dropped with a warning, so a
  flow authored on another build still loads instead of failing whole.
- `writeFlow(dir, name, blocks)` — the same basename guard, and it appends
  `.json` itself rather than trusting a typed extension.

Directory is `flows/` beside `packs/`, wired through `index.ts` the same way.

## Client

**`client/FlowPanel.tsx`** — the builder, inside the existing `host__manage`
details beside `GameSettings`. A row per block with ↑ ↓ ×, a `+ block`, and per
row the mode picker and its option form. The option specs are already data in
`state.games`, so the builder renders every mode's settings with no per-mode
code — the same property that made `GameSettings` possible. Every edit sends the
whole array as `setFlow`.

Beside it: a Load select over `state.flows` and a Save-as input, firing the two
acts. Save is disabled with an empty name.

**The play strip** is one line above the arm controls, outside the fold:

```
Block 2 of 4 · quizbowl · Q3 of 8            [Skip block]
```

The builder folds away because it is setup. The position does not, because a
host who has to open a details element to learn what round it is will not.

**Board** gets one chip in `board__status`: `2/4 · Q3 of 8`. Nothing larger. The
stage belongs to the question, and a flow that draws the eye during a buzz has
failed at its job.

**Phones get nothing.** Which block a player is in changes nothing about their
thumb. What does change — a duel window, a mode's rules — already reaches them
through `duel` and `game`.

## Testing

`server/flow.test.ts`, against a fake applier that records actions:

- count spends, rolls over, and resets `done`
- a spent flow no-ops rather than running off the end
- `flowJump` re-enters, including backwards
- a duel block re-opens a duel each question; a non-duel block opens none
- the mode is applied once per block, not once per question
- `keepScores` survives a cross-block game switch
- `resetRound` does not advance; a double `next` does not double-count
- `setFlow` mid-block preserves the position; an out-of-range one restarts
- `clearFlow` leaves the mode, the value and an open duel alone

One integration test that a mid-flow undo restores the position and the mode
together — the payoff for making a block transition one synchronous mutation
rather than a sequence of socket messages.

Probe gains a `flow:` verb — `flow:trivia*3,quizbowl*2:vote` — and an enshrined
`npm run walk-flow` in the pattern of `walk-duel`, ending in `clear`. `clear`
learns to drop a probe-set flow the same way it drops probe-set teams: only if
probe was the one that set it. `docs/manual-checklist.md` gains its checkboxes.

## Future, deliberately not built

- **Auto-arm.** A block that runs itself. It needs an answer for who owns `arm`
  when a pack is loaded, and that answer is a spec of its own.
- **Per-block teams and mirror.** `setMode` re-keys every score; a flow that
  restructures the standings mid-night needs more care than a field.
- **Per-block packs.** Pack selection triggers a ~30s synthesis and hands `arm`
  to the reader — the contention this design exists to avoid.
- Branching, conditional blocks, nested flows, and per-block timers.
