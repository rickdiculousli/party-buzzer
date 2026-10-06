# Arrival: playable lobby and first-block introduction

Status: proposed design for review. This document and its companion plan are
planning deliverables; product implementation has not started.

## Intent

Make the first few minutes of a game night understandable and social. A joined
player can test their buzzer and see their name respond on the board. When the
host starts a fresh setlist, the room receives one short introduction to its
first block. The host decides when to dismiss it and then uses normal controls
to begin play.

The confirmed scope is the seven-idea roadmap plus a detailed first slice.
This slice includes quiz-buzzer practice and a first-block introduction only.
It does not include minigame practice, introductions at subsequent boundaries,
starter recipes, predictions, milestones, recap/export, or Bow/Tank visual polish.

## Global constraints

- Trusted LAN; no authentication, remote service, or analytics dependency.
- Node is pinned by `mise.toml`; native TypeScript uses `.ts` relative imports, no enums or constructor parameter properties.
- Preact surfaces retain one socket through `useSocket`; browser effects and timing stay in the client.
- `Hub.dispatch` owns host commits and applied/unchanged/refused/failed outcomes; refused or unchanged actions change no history, timers, or broadcast state.
- `shared/legality.ts` owns host-action legality; `shared/wall.ts` owns semantic display priority and remains pure.
- Preserve phone redaction, question/attempt identities, existing scoring, and minigame ownership.
- Use local assets, design tokens, and existing `fx-*`/interest-kit effects; no new dependencies, keyframes, or runtime asset fetches.
- Lobby pulse lifetime is 600 ms, measured locally from receipt; timing measurements remain still.
- Practice never changes scores, round data, items, effects, setlist progress, judge state, or undo history.
- Opening or closing the lobby creates no undo step; introduction dismissal does.
- Arrival is omitted from durable snapshots; introduction participates in undo, lobby does not.

## Current boundaries this design preserves

`Hub.changed()` broadcasts and invokes the persistence/Reader/Judge callback.
Practice receipts therefore need a direct publication path, not `changed()`.
`setSetlist` retains the current position while it fits; a fresh start is the
existing `!keep` path. `loadSetlist` already commits through `setSetlist`.
`Reader.start()` publishes `readingActive` before question preparation.
`Reader.run()` can wait indefinitely after an unsuccessful arm unless its
dispatch result is handled. Minigame blocks currently terminate the reader loop;
crossing them under autoplay is outside this slice.

## Public contracts

Add optional `State.arrival` with this discriminated union:

```ts
export type Arrival =
  | { kind: 'lobby'; id: string; testedPlayerIds: PlayerId[] }
  | { kind: 'introduction'; id: string; blockAt: 0 }

export type PracticeReceipt = {
  lobbyId: string
  seq: number
  playerId: PlayerId
}
```

Every entry gets a fresh UUID. A lobby id is not a question, attempt, match,
timestamp, or block index. Introduction controls carry their id, so an old
button cannot dismiss a newly opened arrival.

Add host actions `{ a: 'openLobby' }` and
`{ a: 'closeArrival'; arrivalId: string }`. Add client message
`{ t: 'practiceBuzz'; lobbyId: string }` and server message
`{ t: 'practiceBuzz'; receipt: PracticeReceipt }`.

`shared/arrival.ts` owns small pure helpers, not a framework:

- `practiceAllowed(state: State, playerId: PlayerId, lobbyId: string): boolean`:
  correct lobby, current connected roster member, no reader or minigame.
- `arrivalBlocksPlay(state: State): boolean`: true for an introduction only;
  the accepted start of real play exits a lobby instead of refusing play.
- `introductionFor(gameId: string): IntroductionCopy`: a static, descriptive
  copy registry, with a generic fallback. It contains no rules or eligibility.
- `arrivalPresentation(state: State): ArrivalPresentation | null`: the public
  lobby/introduction occupant shared by board and phone, without calling the
  full board-only `wallOf` projection on a phone.

`IntroductionCopy` is `{ title: string; goal: string; phone: string }`.
`ArrivalPresentation` is `{ kind: 'lobby' } |
({ kind: 'introduction' } & IntroductionCopy)`.
Known titles agree with the existing game catalogs. Instructions are data;
host/player components do not branch on concrete mode ids.

## Lobby behavior

The host's Play tab offers **Open lobby** in a quiet quiz room, including when
no players have joined. Entry is refused during a non-idle round, reading
(including preparation or paused reading), a duel, a minigame, or a pending
introduction. Repeated entry in the same lobby is unchanged and keeps its id.
Use existing `not-idle`/`minigame-active` refusal codes where applicable and
new `reading-active`, `duel-active`, and `introduction-active` codes for those
specific blockers. Scoped close refusal uses `arrival-changed`.

The board retains the join QR and displays the current roster, including a
tested mark per player. A practice receipt briefly lights that player's name.
Several players can light together; a single latest hero must not erase them.
Names/colors come from the existing roster and identity helpers.

The phone retains its identity bar and presents **Test buzzer**, with
**Practice only · no points** beneath it. A connected joined player can press
repeatedly. The phone immediately uses the existing local press feedback and
then confirms **Buzzer tested** only after the server's own receipt. It returns
to the test control after the pulse. Tested status survives reconnect within
the same lobby; the short flash never replays. An echo establishes server
acceptance, not proof that a board has rendered.

The host sees the tested count and **Close lobby**. These are informational;
there is no unanimous-ready gate. Normal Arm or accepted Read exits the lobby,
as does a successful duel/minigame launch or a fresh setlist introduction.
Settings/roster edits alone do not close it. Applied Undo cancels a lobby;
empty-history Undo leaves it unchanged. Failed/refused/unchanged commands leave
the lobby and receipt sequence untouched.

## Practice transport and ephemeral feedback

Hub accepts practice only from a registered player connection whose current
roster identity passes `practiceAllowed`. Practice ignores quiz lockouts,
freeze effects, grouping, and mode `canBuzz`; it never uses ordinary `buzz`.
On the first accepted press, append that id to `testedPlayerIds` and directly
broadcast role views. On every accepted press, increment a private lobby
sequence and relay a receipt to current connections. Do not call `changed()`
or schedule server pulse timers. Wrong-role, stale-id, removed-player, and
outside-lobby messages produce no mutation or publication.

Each browser keeps the latest receipt per player with an injected/local
monotonic receipt time. Ignore a duplicate or older sequence for that player
and receipts for another lobby. Pulses are active while elapsed time is less
than 600 ms. One surface-level tick drives expiry; never create a timeout per
press. Tick at 50 ms only while pulses remain active, with no ticking in frozen
previews. Repeated presses refresh only that player's pulse. Clear feedback on
disconnect, lobby replacement/exit, and removal of the player. Resolve renamed
players from the latest roster. Reconnect receives tested metadata but no old
receipts. `useSocket` owns receipt ingestion; leaf components own presentation.

## First-block introduction

Create an introduction after existing setup/duel initialization when an applied
`setSetlist` takes its fresh-start `!keep` path with playable blocks. This also
covers saved-setlist loading and replacing a spent setlist. Creating/editing
an existing setlist while retaining its cursor does not create another intro.
If one is pending, kept-position edits preserve its id and show updated content.
An unchanged edit must remain unchanged, including its arrival identity.

The introduction replaces a lobby. The board shows the game title, one goal,
and **First block**. Phones show one instruction and **Waiting for the host**.
Host Play shows **Continue**. It dismisses the matching arrival without
advancing a question/block, arming, reading, seating, or starting a match.
Dismissal is immediate; no timed cinematic sequence or mandatory sound.

Initial copy:

| Game | Goal on board | Instruction on phone |
| --- | --- | --- |
| Trivia | Answer questions to earn points | Buzz to answer. If choices appear, pick one. |
| Quizbowl-lite | Buzz when you know the answer | Listen to the clues, then buzz to answer. |
| Bow | Hit targets to earn points | Drag down and release when the match starts. |
| Tank battle | Work with your crew to earn points | Your controls and crew appear when the host opens the match. |
| Phantom Ink | Help your team find the secret word | Choose a team when the host opens the game. |

Fallback: title is the game id, goal **The host will explain this game**, phone
**Wait for the host to begin**. No pack content, secret word, reader progress,
or correct answer enters introduction metadata.

Arm and minigame preparation are refused during an introduction via shared
legality (`introduction-active`). Read is a playback act: both its control and
`Reader.start()` consult `arrivalBlocksPlay`, with the server returning before
activating/preparing a session. It is not queued. Continue alone cannot start
previously requested playback. Player duel-entry acts are ignored while the
introduction covers the initialized nomination window; they resume afterwards.

Creating an introduction stops a running reader only after an applied commit,
with intermediate runtime publication suppressed as in existing Hub stop/undo
paths. Preparation/card dwell remains abort-scoped. Immediately before arming,
Reader must inspect the dispatch result; a refusal cannot fall into a wait for
an arm that will never occur. Do not add a wait-until-intro-dismissed loop.

Jump, Next, reset, or clearing the setlist clears a pending introduction without
recreating it; later blocks and jumps back receive no introduction in this
slice. Existing skip/escape actions remain available. A stale `closeArrival`
is refused with `arrival-changed`, leaving the new arrival untouched.

## Shared presentation and state ownership

Add `arrival:lobby` and `arrival:introduction` to the shared moment selection
before old choice/verdict moments. Loading a fresh setlist can leave the prior
award in an idle round; arrival must cover it without deleting that round.
`Wall.arrival` carries the arrival occupant; during these moments suppress
old transcript, hero, award, clue, choices, unanswered, and next lanes; set
`timeline` to false and `value` to null. Phone/host
presentation consumes the same semantic facts, including redacted phone state.
An introduction ends before a minigame is prepared, so no new minigame display
priority is introduced. There are no new cue recipes in this slice.

Lobby open/close is a deliberate runtime branch in `Hub.dispatch`, with direct
broadcast and no history or `onChange`. Introduction dismissal uses the normal
state applier, history, and change notification. Snapshot an introduction but
omit a lobby from `gameSnapshot`. Restoring an introduction assigns a fresh id;
old controls/async work remain invalid. Applied undo restores the stored
introduction when appropriate and cancels any current lobby.

Omit all arrival data from `persistedSnapshot`. Explicitly remove it when
loading either versioned or legacy snapshots; legacy load spreads input fields.
Restart returns to normal idle behavior and does not resume/recreate either
arrival. The host may open a new lobby. No durable schema version bump is needed
for a runtime-only optional field.

## Acceptance and validation

- Multiple joined players can test simultaneously and see their own name flash.
- Practice changes only tested metadata and receipt sequence, never gameplay,
  history, persistence callbacks, reader, judge, or buzz timers.
- Disconnect/reconnect keeps the tested mark but never replays a pulse; old
  session messages cannot affect a new lobby.
- A fresh first block is introduced once; retained-position edits do not
  reopen it. Continue and stale controls have the specified outcomes.
- Intro cannot expose a prior answer/choice reveal or accept hidden duel votes.
- Read during intro does not begin later; Arm/Read from lobby restores ordinary
  play. In-flight preparation cannot cause a refused-arm deadlock.
- Undo/restoration and both disk formats obey the ownership table above.

Use pure tests, directly injected Hub connections, and fake speech/temporary
packs. Skip tests for JSX/glue. Run `npm test`, `npm run typecheck`, and
`npm run build` once the slice is integrated. Add frozen review scenarios for
lobby, concurrent pulses, intro, long names, and a disconnected phone; static
views validate layout only. Use `npm run motion` for any changed feedback motion
or sound, and the manual checklist on a disposable room for delivery, sound,
haptics, reconnect, first Arm/Read, and a minigame first block.

Update README operation, ARCHTECTURE ownership, design terminology/presentation,
and the manual checklist with the implemented contracts.
