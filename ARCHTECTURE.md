# Architecture

This document maps the current implementation of party-buzzer. It is a single
Node process serving three Preact browser surfaces on a trusted LAN. The server
owns gameplay; browsers send commands and derive presentation from role-specific
state. Local speech is optional. There is no database, remote game service,
authenticated host boundary, or dynamically loaded plugin system.

For operation, see [README.md](README.md). For working conventions, see
[AGENTS.md](AGENTS.md). Visual language and naming live in
[docs/design.md](docs/design.md). Historical plans may describe older wiring.

## Component map

```mermaid
flowchart TD
    Player["Player browser /"] --> Socket["useSocket / WebSocket"]
    Host["Host browser /host"] --> Socket
    Board["Board browser /board"] --> Socket
    Socket <--> Hub["Hub: routing, commits, buzz timers, views"]
    Player --> Upload["POST /spoken"]
    Upload --> Judge["Judge: answer window and verdict"]
    Hub --> State["state.ts: host actions and transitions"]
    Hub <--> Mini["Minigame runtime: fixed-step world and frames"]
    State --> Rules["Modes, scoring, items, duels, setlists"]
    Hub --> Snapshot["snapshot.ts + state.json"]
    Hub <--> Reader["Reader: packs, playback, autoplay"]
    Hub <--> Judge
    Reader --> Speech["Speech and alignment helpers"]
    Reader --> Judge
    Judge --> STT["Local transcription and answer matching"]
    Hub --> Views["viewFor: role-specific State"]
    Views --> Socket
    Socket --> Presentation["shared/wall.ts + browser components"]
```

Arrows show calls and data flow, not independent services. `Reader` and `Judge`
are objects in the same process as `Hub`. The composition root is
[server/index.ts](server/index.ts).

| Area | Owner | Responsibility |
| --- | --- | --- |
| Startup and transport | `server/index.ts` | Load state, construct services, HTTP(S), WebSocket, spoken uploads, shutdown flush |
| Room coordination | `server/hub.ts` | Connections, dispatch, undo history, collection timers, role views, change notification |
| Game transitions | `server/state.ts` | Apply host actions, distinguish outcomes, coordinate rule modules, load/save state |
| Minigame runtime | `server/minigames/runtime.ts`, `server/minigames/registry.ts`, `server/minigames/bow/`, `server/minigames/tank/`, `server/minigames/ink/`, `server/minigames/sketch/`, `server/minigames/poker/`, `server/minigames/tug/` | Match lifecycle, fixed-step simulation, queued inputs, role frames, ready lobby, touch relay and checkpoints; bow, tank, ink, sketch, poker and tug rules behind registry definitions |
| Buzz ranking | `server/resolve.ts` | Clamp and sort timestamps, deduplicate players, exclude lockouts |
| Gameplay framework | `server/items.ts`, `duel.ts`, `setlist.ts`, `eligibility.ts` | Inventories/effects, seating, block progression, effect and mode eligibility |
| Mode rules | `server/modes/` | Static registry, options, mode memory, scoring hooks and host status |
| Persistence projections | `server/snapshot.ts` | Separate undo data from durable disk data; restore invariants |
| Playback | `server/reader.ts`, `speech.ts`, `align.ts` | Pack preparation, cancellation, playback, reveal boundaries and autoplay |
| Spoken judging | `server/judge.ts`, `stt.ts`, `match.ts` | Attempt-scoped answers, local transcription, matching and verdict |
| Shared contracts | `shared/protocol.ts`, `legality.ts`, `scoring.ts`, `modes/types.ts` | Messages, state types, host legality and reusable rule primitives |
| Shared presentation | `shared/wall.ts` | Pure semantic moments and wall/phone projections |
| Browser runtime | `client/useSocket.ts`, `useReveal.ts`, `sound.ts` | Connection/clock lifecycle, reveal timing and browser audio |
| Browser surfaces | `client/Host.tsx`, `Player.tsx`, `Board.tsx` | Role-specific controls and rendering |
| Local instruments | `tools/`, `client/anim/`, `client/review/`, `vite.config.ts`, `vite.review.config.ts` | Simulations, trace analysis, visual/audio tuning, loudness standard, QA evidence (`tools/qa/`: kinematics, sound character, filmstrips), frozen-state review and Codex delivery |

## Startup and change propagation

`startServer()` loads `state.json`, constructs the Hub and fresh catalogs,
selects available transcription/alignment capabilities, constructs the Judge
and Reader, and attaches the Reader to the Hub. It installs a change callback
that runs, in order:

1. Queue the durable state save.
2. Notify the Reader, including stopping speech when play leaves `ARMED` and
   waking its state waiters.
3. Notify the Judge so its answer window follows the current attempt/leader.

For each `Hub.changed(cause)`, tracing runs first, then state broadcasts, then
that callback. These are synchronous calls; observers can cause further
publications. This is explicit wiring, not an event bus or transactional
observer system. A transcript publication and its subsequent verdict can be
separate frames.

The HTTP server serves the built SPA at `/`, `/host`, `/board`, and `/recap`,
assets from `dist/`, the join QR at `/qr.svg`, the night's recap as
`/recap.json` (the keepsake) and `/recap.svg` (a QR to `/recap`), and WebSocket
upgrades at `/ws`.
`POST /spoken?player=<id>` accepts an answer recording, or text for test tools.
The Judge decides whether the player currently has a valid answer window.

`server/cert.ts` handles cached local-ip.sh certificates; `server/net.ts`
selects a LAN address and builds join information. The domain requires DNS on
joining devices. A raw HTTPS IP address does not match the wildcard certificate.
Closing the server disconnects sockets, closes HTTP connections, and flushes
pending saves.

## Commands, commits, and runtime publications

```mermaid
sequenceDiagram
    participant UI as Host browser
    participant H as Hub
    participant S as state.ts
    participant O as Save / Reader / Judge
    UI->>H: host action
    H->>S: applyHostAction(state, action)
    S-->>H: applied / unchanged / refused
    alt applied
        H->>H: record previous snapshot and adjust timers
        H->>UI: broadcast projected state
        H->>O: onChange(state)
    end
    H-->>UI: actionResult
```

`Hub.dispatch` is the commit entry for host actions, including actions initiated
by the Reader and Judge. `applyHostAction` checks shared legality and validates
mode/rule identifiers, applies a transition, and detects an actual state change.
Refused and unchanged actions do not spend history, cancel timers, or broadcast.
The host receives an explicit result; setlist file loading can also report a
failed result. Undo has its own restoration path inside dispatch.

Not every message is a host action. The `act` route also handles player items,
duel participation, reader controls, file operations, module operations, and
runtime publications such as fragments, revealed answers, and judge windows.
Those paths do not automatically inherit dispatch acknowledgments or undo.
Reader/Judge runtime publications use in-process connection objects, not an
extra network socket.

Bow traffic uses that same continuously open WebSocket. Durable lifecycle
changes (`ready`, `countdown`, `playing`, `results`) ride ordinary projected
state. Aim and release inputs use `minigameInput`; accepted releases enter the
runtime queue and receive `minigameAck` when the next fixed step fires them.
On every runtime pump (roughly 60 Hz), `minigameFrame` sends the shared field to the board and only
the local control projection to a participating phone. The live `BowWorld` is
never written to snapshots. A restart or undo cannot reconstruct an in-flight
world, so it restores the match ready to replay. A definition may be untimed:
the runtime then ignores `durationSec` and completes when the definition's
`finished` hook reports true. Touches are relayed to the audience the
definition names and never stored.

Simulation cadence and publication are separate. Definitions may supply a cheap
semantic `frameKey`; unchanged keys suppress broadcasts while fixed steps and
input acknowledgements continue. Poker uses this for actions, streets, presence,
reactions and level/turn deadlines. Dropped catch-up time also forces a frame to
rebase browser deadlines. Every hello receives its current role frame, including
private phone data only for that player. Poker's browser shot ring, level clock
and final-second tick cues run locally between pushes; they never rerender the
table to advance time. Moving cards and chips sound from their own frames: `Piece`
takes a cue per contact (`soundPlan` over `contacts` in `toss.ts`: start, air, tap, flip,
stop), so `pokerCues` keeps only moments with no motion of their own. Definitions without a key retain continuous frames.

The phone's local peek is owned by `PokerPlayer.tsx`, `poker-bend.ts` and `poker-peek-renderer.ts`; the renderer's mechanics are in [Poker motion costs](docs/audits/poker-animation/README.md#poker-motion-costs).


A long minigame can opt out of losing its world. Four optional definition hooks
serve it, and Poker is the one user. `checkpoint` returns a small durable
summary with a version; after each pump the runtime stores a new version in
`state.minigame.checkpoint` and reports `minigame:checkpoint`, which persists it.
Cancel keeps the checkpoint and results drop it; prepare starts without one. On
Start, a session holding a checkpoint calls `resume` instead of `create`, and
`resume` names the participants. The disk snapshot needs no special case: its
reset of a playing match spreads the session, so the checkpoint rides along.
`presence` hands the definition the connected player ids before each pump's
steps. `hostStatus` returns lines for the host desk, stored in
`state.minigame.status` when they change. Poker checkpoints at the start of
each hand, because its deck follows from the seed and the hand number; a resume
deals that hand again. Minigame results may carry a finishing `place` in place
of points.

Each minigame's host-settable options are `MINIGAME_OPTIONS` in
`shared/protocol.ts`, the same `OptionSpec` schema the modes ship: the runtime
sanitizes `prepareMinigame` against it and the host renders its form from it.
A setlist block may name a minigame (`isMinigameId`). Entering one leaves the
quiz mode alone; with autoplay off the host opens the match from the Play tab
(autoplay opens it, as below), and the hub moves
the setlist to the next block when that minigame closes, in the same undo step.

Under autoplay the Hub also runs the night across blocks (`server/night.ts` holds
the pure predicates; the timers are private Hub memory beside the collection
timers). Entering any fresh block raises an introduction (`server/setlist.ts`
`introduceBlock`, after setup and any duel), spoken by the Reader's `announce`
when a performing voice is on. One timer keyed by the arrival id dismisses it
after `autoplay.introSec`, for blocks after the first only: the first block's
introduction waits for the host's Continue, which also dismisses the others.
Dismissal starts the block: `prepareMinigame` with the block's options for a
minigame other than Poker (folded into the dismissal's undo step, so one Undo
restores the introduction with no match), `reader.carryOn()` for a block with a
pack, nothing for Poker, a packless block, or any block while a minigame is
still open. `carryOn` is `start()` without the spent-pack rewind, and both cut a
still-playing announcement. The phone Ready bar renders only under autoplay and
the surface above it gives up the bar's height. The match it opened is remembered by `matchId`; while it waits in `ready`,
every connected player tapping Ready (`MinigameLobby.ready`) or a 60 s fallback
dispatches `startMinigame`, and `nextSec` after results the Hub dispatches
`closeMinigame`, which advances the setlist and raises the next introduction.
Every step goes through `Hub.dispatch`, is re-derived from state after each
`changed()` and undo, and accepts a refusal silently. A host cancel mints a new
matchId and is left alone. Timers clear on undo, `clearSetlist`, `setlistJump`
and autoplay off; the Reader stays the only `arm` issuer.
A definition's `create` receives the room (`MinigameRoom`: players, teams,
grouping, scores) as well as the participants, so a game can split sides from
standings or teams (Tug of war does). `finished` may end a timed match before
its clock (Tug of war stops at the mark); see `server/minigames/definition.ts`.
On the client, `client/minigames.tsx` holds one registry row per minigame — name,
timed flag, lobby side-picking, player surface, board surface — and
`client/minigame-info.ts` holds the JSX-free half of it, including
`MINIGAME_CATALOG` for the host's pickers and `matchFrame`, which every surface
uses to reject a frame from another game, role, or match.

`Hub.fragmentEnded(questionId, completed)` is a dedicated playback-to-mode
boundary. It rejects stale questions and non-armed phases, calls the current
mode hook, and publishes only if that hook changed state. It is not an undo
step. Keep this distinction when adding a new operation: a deliberate game
command, transient runtime fact, and playback event have different lifetimes.

## Round lifecycle and identity

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> ARMED: arm a new question
    ARMED --> COLLECTING: first eligible buzz
    COLLECTING --> LOCKED: collection deadline
    LOCKED --> IDLE: correct
    LOCKED --> ARMED: wrong / rebound when permitted
    ARMED --> IDLE: next or reset
    COLLECTING --> IDLE: reset
    LOCKED --> IDLE: next or reset
```

This diagram summarizes the main paths; `shared/legality.ts` and mode rules
remain authoritative for whether a particular action is allowed. Autoplay can
hold a wrong verdict in `LOCKED` before a delayed rebound.

| Identity or timing | Meaning |
| --- | --- |
| `questionId` | Fresh on arm; stable across rebounds of the same question |
| `attemptId` | Fresh on arm, rebound, and active-question undo restoration |
| `armedAt` | Scheduled opening time, normally 300 ms after arming |
| Collection timers | Hub-owned provisional reveal at 150 ms and lock at 1000 ms after first buzz |
| Reader session/cancellation | Controls pending preparation, playback and dwell work |
| Judge attempt/leader key | Rejects answers or transcription results belonging to an old opportunity |

Press resolution clamps client time to `[armedAt, arrivedAt]`, takes the
earliest press per player, and sorts with deterministic tie-breaking. This is
jitter accommodation for trusted clients. Lockouts use shared player/team
score keys; effects and mode eligibility are checked through `eligibility.ts`.

Effects assigned to an attempt follow its identity. Do not use equal timestamps,
a repeated player, or the number of displayed fragments to infer that async
work still belongs to the current question. Reader callbacks check question
identity and cancellation; Judge work checks attempt, leader, and primed answers.

## State, role views, and presentation

The authoritative `State` includes gameplay plus selected runtime facts and
catalogs. It is not sent unchanged to every role and is not saved wholesale.

`Hub.viewFor` projects each broadcast:

- Host and board receive the full buzz order and reader progress. Only the host
  receives computed `game.status` from the current mode's `hostStatus` hook.
- Phones receive only their own order entries, plus the total buzz count.
  Their own entry marks whether it leads; a rounded `0 ms` margin can also
  belong to a later buzz.
  Reader progress and `round.whole` are always omitted.
- Phones receive revealed fragments and the revealed answer only when text
  mirroring is enabled. Mode memory is hidden by default; `viewModuleState`
  can explicitly project it.
- `readingActive` is public so all surfaces can select the same semantic moment
  without needing private playback progress.

The whole question **can be present in State** for board layout before it is
spoken. Phone redaction prevents reading ahead. Unrevealed accepted answers
remain private in Reader/Judge memory; the display answer enters State when
revealed. Keep those separate when adding content or projections.

`shared/wall.ts` chooses a semantic moment from public gameplay facts plus local
presentation inputs (`open`, `settled`, `retired`). Its 23 moments belong to eight
families; the `arrival` family (lobby, introduction) ranks above everything and, while
it is up, empties every other wall lane so retained verdicts and choices cannot show through; the `choice` family ranks first while a choice question is up, and the `closest` family likewise for a closest question.
A choice question keeps the clue in the middle band and puts `Wall.choices`, a
grid, in the band below, so no hero appears. Wall and phone projections use this shared decision; the wall selects
one middle occupant, such as a clue or hero. Browser effects supply clock and
animation progress. Equal inputs yield equal moments, but individual browsers
can be at different local animation stages.

Arrival state (`State.arrival`: an open lobby or a block introduction) is public
to every role, so `arrivalPresentation` in `shared/arrival.ts` serves the board and
phone alike. The Hub owns a lobby directly: `openLobby`/`closeArrival` for a lobby bypass
history and `onChange`, and `practiceBuzz` marks a player tested in State, then relays a
`PracticeReceipt` (lobby id, per-lobby `practiceSeq`, player) to every connection. The
sequence counter and pulses are private runtime. Browsers keep the latest receipt per
player with local receipt time (`client/arrival-feedback.ts`, `usePracticeTime`); the
pulse lasts `PRACTICE_PULSE_MS` and is lobby-scoped, so a stale lobby's receipt is ignored.
`ArrivalBoard`, `ArrivalPhone`, and `ArrivalHost` are mounted by their surfaces; the
host's disabled controls follow `refuses` and `arrivalBlocksPlay` rather than a second ladder.

`client/main.tsx` chooses a surface by pathname. Each surface uses `useSocket`
for its own connection. That hook handles reconnection, stored player identity,
clock-offset sampling, and scheduled opening. Host controls use shared legality;
phone behavior uses the redacted view and phone projection rather than applying
full-state host rules.

## Modes and composable rules

`shared/modes/types.ts` defines `GameModule<Options, Memory>`. A mode gets a
restricted context of players, teams, grouping, scores, round, and its own game
options/memory. Its option schema is checked against its typed option fields.
The heterogeneous registry and wire format necessarily erase some of those
concrete types; options are sanitized at the registry/state boundary.

`server/modes/index.ts` registers trivia, quizbowl and buzzer statically. Optional hooks
cover arming, buzz eligibility, scoring, completed fragments, host acts, status,
viewer memory, and item grants. Trivia uses framework defaults. Quizbowl owns
power cutoff, neg/bounceback rules, and optional item grants. Buzzer stamps
zero-point awards and never locks anyone out; its `scoreless` flag rides the
catalog so the host desk can hide value, standings, reader and duels without
naming the mode.

The Reader reports completed fragments for both joined and fragment playback.
Quizbowl interprets that event to end power; it returns semantic status such as
“Power open” for the host to render. The Reader and host UI do not interpret
quizbowl options. The older `powerEnds` host act remains a compatible path.

Modules declare item grants as data. `items.ts` validates recipients and executes
named or random grants. `shared/scoring.ts` owns score-key selection, score
increments, and lockout helpers. Neither feature needs an import back into the
state transition coordinator.

Duels own entry/voting, seating, and who may participate. Setlists own block
configuration and progression, delegating settings changes through state
transitions. Saved pack/setlist catalogs are handled by `packs.ts` and
`setlists.ts`. These are framework capabilities shared across modes.

A mode switch is allowed while idle; choosing a different mode normally resets
scores unless the transition requests preservation. Updating options on the
same mode keeps scores and existing memory until its lifecycle hook resets it.
This is a bounded game-mode interface, not a general-purpose plugin lifecycle.

## Reading and judging

The Reader owns question packs and in-memory per-pack positions. Selecting a
pack starts queued speech preparation, with cached clips and bounded rendering
concurrency. Preparation can continue in the background, but each question waits
for its required audio before the Reader arms it. Setlist packs can be queued
ahead of their blocks.

With alignment available, the Reader plays a joined question and uses located
fragment/clause boundaries for progressive reveal and resume. Without alignment
capability, it uses fragment clips. A failed alignment of a joined clip can
produce coarse end-of-clip reveal. Speech uses `say` and media inspection, with
a compiled Swift seeking player when available and `afplay` as fallback.
Without native speech commands, playback degrades to silent text progression.

With `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` set, `server/eleven.ts`
renders ElevenLabs v4 takes in place of `say`. Each take is cached beside its
per-character timestamps, and folds come from those timestamps rather than from
transcription. That voice
also performs: a question's `S:` script is spoken in place of its fragments,
`R:` plays on a right answer, and `server/quips.ts` picks sparse verdict quips
from `packs/quips/pools.txt`, each line its own take. The Reader prices
the unrendered text per pack (`packCost`) for the host screen. A failed take
falls back to `say`.

Buzzing interrupts speech. Autoplay waits for verdict, applies the configured
dwell, then rebounds or advances. Seeking can resume at the interrupted clause;
a joined clip without seeking support can restart from its beginning. Reader
cancellation prevents stopped/replaced sessions from driving later questions.

Each question has a kind. `speakQuestion` reads read and shown questions the
same way; a shown one publishes every fragment at the arm, and the mode still
hears each fragment end as the voice passes it. `runChoice` publishes a choice
question's options after the question is read, reads them, publishes
`closesAt` when that clip ends, and waits for every eligible picker
(`shared/choice.ts`), the deadline, or the host's `closeChoice`. It then
dispatches `settleChoice`, which pays every right pick without calling the
mode's scoring hooks. The round stays `ARMED` while picking and never passes
through `COLLECTING` or `LOCKED`. Phones submit a `pick` act; `viewFor` redacts
`picks` to the viewer's own and sends shown and choice text regardless of the
mirror.

`runClosest` is the same shape for a closest question, with nothing to read
after the question: it publishes `round.guessing` (`unit`, `closesAt` after
`choiceSec`) at once and waits for every picker to guess, the deadline, or the
host's Close (the same `closeChoice` act). `settleClosest` carries the pack's
number; `closestAwards` in `shared/scoring.ts` pays it and the transition
records `truth` and `paid`. Phones submit a `guess` act with a finite number,
checked by `guessBlockReason`; `viewFor` redacts `guesses` to the viewer's
own. The result (`truth`, `paid`, `nearest`, `guessed`) is public once settled.
The board plays the reveal on the `closestTimes` schedule, and phones and the
board's standings hold the pre-settle picture until it is done
(`useClosestHold`); under autoplay the reader adds that time to the dwell.
The board places the guesses on a line scaled by `shared/closest.ts` only at
the reveal, so no number is up while the room is still guessing.

A picture reveal (`K: reveal`, which needs an `I:` picture) is a buzz question
read like a shown one. Its `arm` stamps `round.reveal = { from, until }`: the
arm instant and `revealSec` after it, in server time. That one public fact
drives both halves. `shared/scoring.ts` prices a buzz from its clamped stamp
against it (`revealValue`: 2× in the first quarter, a quarter less each
quarter, 1× once sharp), and `correct` pays `leaderValue` (quizbowl adds its
power bonus to the same number). A `wrong` stamps `reveal.heldAt` with the
leader's stamp, and `openRebound` (or an undo that reopens the attempt) moves
the window with `resumeReveal` so the picture carries on from there. The wall
projects it as `Wall.reveal` (`revealHeldAt`: a miss, else the leader's press),
and `client/RevealPicture.tsx` draws the mosaic through a canvas on a fixed
250 ms step (`client/reveal.ts`), beside a stakes chip that decays on the same
steps. Under autoplay the reader's buzz window is the buzz beat after the
picture is sharp, recomputed when a rebound moves it. `viewFor` keeps a reveal
picture off phones until the question is over, and then sends it only with the
mirror on.

The Reader primes the Judge with private accepted answers. The Judge offers an
answer window for the current locked leader, accepts a submission, transcribes
when necessary, matches it, and sends the verdict through `Hub.dispatch`.
Submitted-attempt tracking prevents reentrant state publications from opening
another submission for the same opportunity. Late results after re-prime,
rebound, undo, or another question are discarded.

Question voice comes from the server machine. Browser cue audio is a separate
system: `cues.ts` defines recipes, `sound.ts` schedules them and reads scoped
tunables, and `synth.ts` supplies synthesis primitives. Cue levels follow one
standard: `tools/loudness.ts` renders each recipe offline, measures its loudest
100ms (K-weighted LUFS) and holds it to a tier (hero, event, signal, foley,
air); `npm run loudness -- --apply` rescales a cue onto its tier. Levels are set
for the board; the phone surface plays everything 6dB down. Browser microphone
recording is handled by `Talk.tsx`, `recorder.ts`, and `wav.ts`.

## Undo versus restart

`server/lifetimes.test.ts` is the source of truth: one row per `State` field for undo, disk and phone, checked against `gameSnapshot`, `persistedSnapshot` and `viewFor`.

| Data | Undo snapshot | Disk snapshot |
| --- | --- | --- |
| Players, teams, scores, settings, inventories | Yes | Yes |
| Connection flags and catalogs | Preserve live values | Rebuilt; players start disconnected |
| Current round/question and mode memory | Yes, with restore rules | No; retain round value and mode configuration |
| Playback state and judge window | No | No |
| Setlist position | Yes | Yes |
| The night's ledger (`night`), absent from phone views (`/recap` fetches the keepsake instead) | Yes; undo retracts its facts | Yes |
| Arrival introduction (`blockKey` survives a restore, `id` does not) | Yes, restored under a fresh id | No |
| Night automation timers and the match autoplay opened | No; undo clears them | No |
| `autoplay.introSec`, minigame lobby `ready` | Yes | Yes |
| Arrival lobby, tested ids, practice sequence | No; undo cancels a lobby | No |
| Reader per-pack cursor | No | No |
| Attempt-bound effects | Restored and restamped | Excluded; unassigned effects can persist |

`gameSnapshot` and `restoreGame` define undo. Hub retains at most 20 snapshots
for applied actions. Restore preserves new arrivals and their scores, removes
fields absent from the snapshot, and leaves current catalogs/connections intact.
Undo stops reading and unprimes judging. A restored collection or held verdict
reopens; a settled leader can remain locked for manual judging. A fresh attempt
identity invalidates old work. Audio and pack position are not rewound.

`persistedSnapshot` defines version 2 disk data (version 2 added `night`; a
version 1 file loads with an empty ledger). `state.ts` queues writes per
path with a short debounce and flushes them on close. This is a whole-file
snapshot, not a journal or database. Loading supports the prior unversioned
shape, initializes mode memory, and resets the round. Unknown versions or
unreadable data fall back to a new state with diagnostics. Snapshot support is
not a universal migration for all historical field or directory renames.

The night's ledger is recorded by `server/ledger.ts` (pure) from `Hub.dispatch`,
`completeMinigame` and item use, and derived into milestones and recap cards by
`shared/recap.ts`. Once the setlist is spent, `server/nights.ts` writes the
keepsake to `nights/<date>.json`; the host's `clearNight` forgets the ledger.

## Development and validation

Native TypeScript runs directly under the pinned Node version. Vite builds the
browser application into `dist/`; the server does not build or watch it.

For HMR, the current proxy requires a plain HTTP backend at 8080. From the repo
root, this starts one without certificate or transcription-helper setup:

```sh
node --input-type=module <<'JS'
import { startServer } from './server/index.ts'
const server = await startServer({ tls: false, transcribe: null })
console.log(server.url)
process.on('SIGINT', () => {
  void server.close().then(() => process.exit(0))
})
JS
```

Run `npm run dev` in another terminal. This uses the normal saved room unless
you supply another `statePath`. Vite proxies `/ws` and `/qr.svg`, but not
`/spoken`; use the built HTTPS app for microphone flows.

`npm run motion` opens the standalone workbench. Its scenarios mount real
components, and its save endpoint edits marked CSS tunables and cue recipes.
The sound-library endpoints inspect local raw audio and adopt processed clips
using a locally installed `ffmpeg`, writing assets and credits. Those development
endpoints and `anim.html` do not ship in the production build.

`npm run review` uses a separate loopback Vite configuration. It serves
role-projected scenarios generated through `Hub.viewFor`, then mounts the real
board and player components with an explicit frozen socket fixture. In preview
mode those components suppress sockets, clocks, audio, wake locks, microphone
access, haptics, and actions. The review frame adds a transparent selection
layer, so disabled controls can be annotated without invoking them.

The review Vite plugin owns the development-only `/__review/*` routes. It
captures selected frames with Chromium, atomically writes ignored bundles under
`.review/batches/`, and invokes `codex queue` with argument arrays to target the
exact supplied terminal conversation. `tools/review/report.ts` is the narrow
status path back from that agent. None of these pages, routes, or tools are part
of `npm run build`. Static review fixtures do not validate real timing, speech,
microphone, network, or multi-device behavior.

| Validation area | Where to look |
| --- | --- |
| Actions, legality, history, persistence | `server/actions.test.ts`, `server/snapshot.test.ts`, `shared/legality.test.ts` |
| Ranking and WebSocket behavior | `server/resolve.test.ts`, `server/hub.test.ts`, `server/integration.test.ts` |
| Reader cancellation, timing and reveal | `server/reader.test.ts`, `server/reader.joined.test.ts` |
| Judging and stale answers | `server/judge.test.ts` |
| Mode boundaries and composed rules | `server/modes/*.test.ts`, `server/game-modes.integration.test.ts`, duel/setlist integration tests |
| Presentation and scoring | `shared/wall.test.ts`, `shared/scoring.test.ts`, `client/*.test.ts` |
| Tooling, audio asset processing, loudness tiers and QA probes | `tools/*.test.ts`, `tools/qa/*.test.ts` |
| Frozen preview isolation, annotations and delivery bundles | `client/review.test.ts`, `tools/review.test.ts`, `npm run test:review` |
| Physical phones, microphones and room audio | `docs/manual-checklist.md` |

`server/e2e.ts` provides real WebSocket clients and isolated server fixtures.
Logic tests inject speech/transcription/alignment capabilities. `npm test`
collects all five test locations; `npm run typecheck` and `npm run build` cover
compilation and bundling. Native speech capability and real devices still need
appropriate platform validation.

`TRACE=1` records Hub changes to `trace.jsonl`; `tools/trace.ts` inspects them and
`tools/rules.ts` checks trace invariants. Simulation, probes, fakes, and walkthroughs
are active clients: they change whichever room they connect to.

## Where a feature change belongs

- **New host command:** protocol and shared legality, state transition, dispatch
  outcome/history tests, then host control and result presentation.
- **New mode rule:** typed mode options/memory and hooks, registry entry if a new
  mode, generic status/schema rendering, and composed gameplay tests.
- **New player ability:** item/duel ownership and eligibility, role-checked act
  handling, phone control, and effects/lockout tests.
- **New state field:** choose live ownership, role visibility, undo and disk
  lifetimes explicitly; test restoration and redaction where affected.
- **New display behavior:** semantic moment/projection when it changes meaning;
  browser components and workbench scenarios when it changes presentation.
- **New asynchronous operation:** choose question or attempt scope, cancellation,
  stale-result checks, and behavior under stop, rebound, undo, and restart.

Keep these paths explicit. The existing boundaries support adding features
without requiring another coordination framework or separate mode-specific UI.
