# Heads-up duels and the candidacy seam

A two-player face-off round, composable with any game mode, built as the first
consumer of a candidacy layer that sits above modes. This spec is deliberately
the seam plus one feature — no flow sequencer, no block list — but every shape
in it is chosen so a future "setlist of blocks" (N rounds of mode A, then two
rounds of mode B as duels, then more B) drops in as a driver that replays the
same host actions, the way `server/reader.ts` already drives the hub through a
synthetic host connection.

## Decisions

- A heads-up round restricts buzzing to two finalists. A wrong answer hands an
  exclusive rebound to the other finalist; if both miss, the round is dead and
  the host moves on.
- Finalists are chosen by a **rule** that runs when the duel is triggered:
  host-pick, random, or nomination (vote / volunteer / back-off gates).
- Nomination windows have no timer. The host watches the pool and closes it.
  Ties under vote resolution break in favor of whoever reached the count first.
- In teams mode the two finalists always come from different teams, enforced by
  resolution and override validation alike.
- Duel questions come from the loaded pack when the reader is running (the
  reader needs no changes — candidacy is stamped at arm time) or are
  host-supplied otherwise.
- The pool and vote totals are visible to players during the nomination
  window — the room sees what the board sees.

## Protocol (`shared/protocol.ts`)

```ts
// Round — the enforcement point. Absent = everyone, which is today's game.
export type Round = {
  // ...existing fields
  /** The only players who may buzz this round. Set by a duel; absent = open. */
  candidates?: PlayerId[]
}

export type DuelState = {
  rule: string                       // id into the duelRules catalog
  /** The nomination pool. Empty for host-pick/random, which seat instantly. */
  pool: DuelPoolEntry[]
  /** Set once the host closes the window (or an instant rule resolves). Cleared on `next`. */
  seated?: [PlayerId, PlayerId]
  /** Finalists who answered wrong this question — drives the exclusive rebound. */
  missed: PlayerId[]
}

export type DuelPoolEntry = {
  playerId: PlayerId
  /** Voter ids, not a count — one vote per player falls out of the data shape. */
  votes: PlayerId[]
  /** Volunteered and not backed off. */
  in: boolean
}

/** Shipped in State beside `games`; the host UI renders rule pickers from data. */
export type DuelRuleInfo = {
  id: string
  name: string
  entry: 'vote' | 'volunteer' | 'both' | 'none'   // 'none' = host-pick / random
  resolve: 'votes' | 'random' | 'host'
}

// State gains:
//   duel?: DuelState
//   duelRules: DuelRuleInfo[]   (static catalog, refreshed at startup like `games`)

export type HostAction =
  | ...existing
  | { a: 'openDuel'; rule: string }
  | { a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }  // ids = host override; absent = resolve by rule
  | { a: 'cancelDuel' }
```

Player entry rides the existing `act` channel, like items: `duelVolunteer`,
`duelBackOff`, `duelVote` (data = target id). Gate-violating acts are dropped,
per the channel's existing contract.

Deliberate omissions: no timer, no per-rule options (the catalog shape has
room), no auto-lock on back-off, no flow sequencer.

## Server

**The buzz gate** is one check in the hub where buzzes are already validated,
placed before the mode's `canBuzz`:

```
if (round.candidates && !round.candidates.includes(playerId)) drop
```

It composes with lockouts rather than replacing them. `resolve.ts`, the clamp,
and ordering are untouched — a filtered buzz never reaches resolution.

**`server/duel.ts`** is a framework module modeled on `items.ts`:

- The **rule catalog**: `host-pick` (entry none / resolve host), `random`
  (entry none / resolve random), and nomination rules built from the gates —
  `vote` (vote / votes), `volunteer-random` (volunteer / random),
  `volunteer-backoff` (volunteer / host). Rules are data; gates are fields, so
  future rules are rows, not code.
- **Resolution**: votes → plurality per seat, ties by who reached the count
  first; random → draw from the `in` pool; host → requires explicit ids. In
  teams mode every resolver is wrapped with the one-per-team constraint: seat 1
  resolves first, seat 2 resolves from the remaining teams. Unsatisfiable
  (fewer than two teams, pool too thin) → resolution returns nothing, the
  window stays open, the host sees why and picks or cancels.
- **Act handlers** for the three player acts, validated against the rule's
  gates. A vote under a volunteer-only rule is dropped; double votes are
  impossible by the data shape; back-off only applies when `in`; re-voting
  moves the vote.
- Two hooks the state machine calls: `duelOnArm` stamps
  `round.candidates = seated − missed`; `duelOnWrong` appends the leader to
  `missed`.

**The rebound falls out of that**: wrong → leader enters `missed` → re-arm
stamps candidates as just the other finalist. Both miss → empty candidates,
nobody can buzz, host `next`s. Exclusivity is guaranteed by candidacy itself,
independent of the mode's bouncebacks option.

**Lifecycle guards**: `openDuel` only while the round is `IDLE`;
`setGame`/`setMode` cancels an unseated duel; a seated duel survives until
`next` clears it. Disconnects never auto-collapse a seat — the host kicks,
cancels, or overrides, same philosophy as the existing kick flow.

## Surfaces

**Host** — one panel, idle-collapsed:

- Idle: "Heads-up" opens a rule picker rendered from the `duelRules` catalog.
- Window open: the pool streams in live (vote counts and/or volunteers per the
  gates); the current would-be resolution is highlighted. Buttons: **Seat
  them**, tap-two-to-override, **Cancel**.
- `host-pick` skips the window to tap-two; `random` seats immediately and shows
  the drawn pair.
- Seated: the pair shows beside the round controls until the question ends.

**Player**:

- Window open: entry UI matching the gates — volunteer toggle with live count,
  tap-to-vote roster, or both. The pool with totals is visible to everyone.
- Duel round: finalists get the normal buzzer; everyone else gets a spectator
  card ("Ada vs Bo"), timeline visible after lock as today.

**Board**: window open shows the pool forming; a seated pair gets a face-off
frame held through the question and award. Presentation only — no board logic
beyond reading `state.duel`.

All three surfaces derive everything from `state.duel` + `round.candidates`
above the `if (!state)` guard; zero client-side game logic.

## Error handling

- Close with a thin pool resolves nothing; window stays open; host sees why.
- Override ids are validated (distinct, connected, one-per-team in teams mode)
  or rejected. Naming a non-pool player is legal — gates constrain entry, not
  the host.
- Duplicate or out-of-turn acts dropped by gate validation.
- Undo mid-window restores pool state; duel rides the same snapshot stack.
- Snapshots from builds lacking `duel`: absent means no duel.

## Testing

- `server/duel.test.ts`: each resolver, one-per-team wrapping (including
  unsatisfiable), vote switching, back-off, gate violations.
- `server/hub.test.ts` additions: non-candidate buzz dropped; finalists buzz;
  wrong → rebound stamped to the other finalist; both miss → empty candidates;
  duel cleared on `next`.
- Integration over real sockets in the style of `game-modes.integration.test.ts`:
  open → vote/volunteer → close → arm → buzz.
- Redaction: pool visible to players, nothing else leaks.
- No client unit tests; surfaces verified with `npm run sim` and, for the
  face-off frame, `npm run motion`.

## Future, deliberately not built

A flow layer: `state.flow` as an ordered block list (mode + options + round
count + optional candidacy rule), walked by a driver that issues `setGame`,
`openDuel`, `arm` over a synthetic host connection. The hub never learns that
blocks exist. This spec's rule catalog, host actions, and `round.candidates`
gate are exactly the seams that driver plugs into.
