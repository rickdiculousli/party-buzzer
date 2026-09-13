# Minigames framework and bow proof of concept — design

Date: 2026-09-06

Party Buzzer gains setlist-native real-time minigames. Bow is the first
minigame and proves the framework with simultaneous phone controls, a shared
board field, server-authoritative physics, and one score commit at the end of
each match.

This document defines behavior and ownership. The visual language,
microinteractions, motion studies, and impact feedback belong in a separate
design document supported by comparative SVG studies.

**Implementation note, 2026-09-11:** Build and validate the mechanics with
plain geometric placeholders before returning to visual design. The September
6 visual studies were exploratory and are not implementation references. A
future visual pass must first establish one coherent style for the whole
minigame, then apply it consistently to individual components.

## Decisions

- A minigame is a normal setlist block and contributes to the existing scores
  and standings.
- Minigames form a subsystem alongside question modes. They do not extend the
  question-mode hooks with continuous simulation concerns.
- Every bow match is simultaneous. All connected players fire into one shared
  field for 40 seconds by default.
- The server owns gameplay and scoring. Phones send intent; the board presents
  interpolated server frames.
- Minigame traffic shares the existing continuously open WebSocket. A second
  connection is added only if measured contention shows a need for it.
- The first version uses a small custom 2D simulation with simple collision
  shapes. It does not add a general game engine.
- Target points earned during the match are added directly to the existing
  scores in one undoable commit.
- Live physics is transient. Setlist position, match lifecycle, and final
  results are state; individual simulation frames are not durable state.

## Vocabulary

Existing canon words keep their meanings. A **match** is one synchronized
minigame start-to-result cycle. A minigame setlist block contains one or more
matches, while a question block contains questions. A match is not described
as a question, and the minigame field is not called the stage: `--stage`
remains the backdrop colour.

The design guide's canon section gains this distinction when the feature is
implemented.

## Architecture

### Setlist blocks

`SetlistBlock` becomes a discriminated union. Existing question blocks retain
their current data and snapshot compatibility. A minigame block identifies a
registered minigame, its options, and its match count. Host labels and progress
derive from the block kind, so question blocks continue to say “questions” and
bow blocks say “matches.”

The setlist remains the sole sequence for a game night. Entering a minigame
block makes its first match ready; advancing a completed match increments that
block's progress, and advancing its last match enters the next block. Freehand
host controls may also select and run a minigame without a setlist.

Old setlists without a discriminator load as question blocks. Minigame ids and
options are validated against the static registry before a setlist edit is
committed.

### Minigame definitions and registry

A static registry under `server/minigames/` maps ids to typed minigame
definitions. Bow is its first entry. A definition owns:

- its option schema and defaults;
- creation of a fresh simulation world;
- validation and application of player input;
- one fixed simulation step;
- role-specific frame projections;
- completion and result calculation.

The framework owns clocks, socket routing, match identity, lifecycle,
broadcast pacing, history, score commits, and cleanup. A definition cannot
write browser state, schedule its own timer, or mutate the wider Party Buzzer
state. Future minigames are explicit registry entries rather than dynamically
loaded plugins.

Concrete minigame rendering is selected through static client registries for
the player and board. `Player`, `Board`, and `Host` route through generic
minigame surfaces and do not accumulate `if (id === 'bow')` branches. The host
settings UI renders common option schemas and lifecycle controls.

### Durable lifecycle state

`State` gains an optional minigame session containing:

- minigame id and sanitized options;
- a stable `matchId` for the current match;
- `ready`, `countdown`, `playing`, or `results` phase;
- synchronized `startsAt` and `endsAt` server times when applicable;
- current match number and total matches;
- final per-player results after completion.

Question `round` state stays idle while a minigame block is active. A fresh
`matchId` is created for each start or restart. Every input and frame carries
that identity so delayed work from a cancelled or previous match is ignored.

Ready and results state may be snapshotted. A countdown or playing match is
restored as ready with no result and no award: a process restart cannot
reconstruct the transient world fairly. Undo restores the pre-result scores
and lifecycle state, then leaves the match ready to replay.

### Runtime simulation

A server-side `MinigameRuntime` is wired in `server/index.ts` beside the hub.
It owns the active world, fixed-step accumulator, input sequence tracking, and
frame timer. The first implementation targets a 60 Hz simulation step and a
roughly 20 Hz network frame rate. Those rates are tunables rather than facts
embedded in bow rules.

The runtime advances with fixed-size steps even when a Node timer arrives
late. It caps catch-up work per timer turn; if the process falls materially
behind, elapsed time is skipped rather than allowing an unbounded catch-up
spiral. The authoritative match deadline remains server time.

Board rendering runs at display refresh rate and interpolates between the two
most recent authoritative frames. Interpolation changes presentation only.
Scores, collisions, and the final world are always calculated by the server.

The world applies entity lifetimes and a hard cap so repeated shots cannot
grow work without bound. Lodged arrows remain as temporary obstacles long
enough to affect play, then expire. Bow begins with swept circles or capsules,
gravity, simple restitution, and explicit collision pairs rather than a
general rigid-body solver.

## Wire and command boundaries

Player input uses a dedicated minigame message rather than the low-frequency
module `act` channel, but it travels over the existing continuously open
WebSocket. Its envelope contains the minigame id, `matchId`, a monotonic player
sequence, and minigame-specific input. Bow input consists of normalized aim
updates and a discrete release command. A release also carries a server-domain
release time calculated through the connection's existing clock sync. The
server validates the active match, role, player participation, sequence,
finite numeric bounds, lifecycle window, and reload eligibility before
applying it.

Aim updates may be coalesced because only the latest direction and tension
matter. Releases are discrete and never coalesced or skipped because they land
between simulation ticks. An accepted release enters an input queue and fires
on the next fixed simulation step. It is not queued across a lifecycle or
reload boundary: a gesture made during countdown or while reloading is refused
rather than firing unexpectedly when it later becomes legal. The phone renders
its own drag immediately; network updates do not sit in the finger-feedback
path.

Each release sequence receives an accepted or refused acknowledgment. The
server remembers the disposition for the active match, so a phone may retry an
unacknowledged release after reconnecting without creating a second arrow. An
acknowledgment confirms authoritative firing; it does not delay the phone's
local release feedback.

At the match deadline, the client stops creating releases at `endsAt`. The
server retains a 250 ms input grace window for packets already in flight. The
duration is a runtime tunable shared by every minigame. A release is accepted
during that grace only when its timestamp,
clamped to the interval from `startsAt` through its server arrival time, falls
on or before `endsAt`. The arrow is spawned on the next simulation step; the
simulation does not rewind to its claimed release time. Packets arriving after
the input grace are refused so a match still has a deterministic end. The
input grace is separate from the longer landing grace for arrows already
accepted.

Simulation frames use a dedicated server message containing `matchId`, tick,
server time, and a role projection. The board receives the shared field.
Phones receive the lifecycle plus only the control and result facts relevant
to that player. Durable lifecycle changes still travel in ordinary state
messages.

Using one WebSocket preserves ordering between lifecycle messages and inputs
and avoids a second browser connection. WebSocket already supplies a
continuous, reliable, ordered TCP stream; minigame message framing is not
expected to be a meaningful latency source at LAN payload sizes. The client
send path does not batch a release behind coalescible aim updates. Load tests
measure input-to-board latency while ordinary state messages are present; a
second WebSocket remains a measured optimization rather than an initial
boundary.

Starting, cancelling, and advancing are host actions governed by
`shared/legality.ts`. Their outcomes retain the existing applied, unchanged,
refused, and failed distinctions. A refusal or no-op changes no history,
runtime timer, durable state, or broadcast state.

Automatic completion enters the hub through an internal result commit. The
commit verifies the active `matchId`, records the result, applies all player
score deltas, stops the runtime, and creates one undo entry. A late completion
from a cancelled match is unchanged. The result commit is not accepted from a
wire client.

## Bow match

### Lifecycle

Entering the block places each currently connected player along the bottom of
the shared field and leaves the match ready. The host starts it, publishing one
future `startsAt` time for a synchronized three-beat countdown. Inputs cannot
fire an arrow before that instant.

The default match lasts 40 seconds. Players may take repeated shots subject to
a short reload. When `endsAt` arrives, phones stop creating releases. The
server briefly accepts release packets stamped before the deadline, then
refuses further input. Accepted arrows receive a separate, fixed grace period
to land. The server then freezes the field, calculates results, and commits
every player's earned target points together.

The host may cancel a countdown or playing match. Cancellation awards nothing
and returns the same match to ready with a new identity on its next start. At
results, **Next** advances the match or setlist block.

Players who join during countdown or play spectate until the next match.
Disconnecting does not remove a placed bow or erase earned points; reconnecting
with the same player id restores control. If no eligible players remain, the
host can cancel or let the match finish normally.

### Controls and rules

The phone is portrait-first. A drag may begin anywhere in its large control
surface. Drag direction sets the shot angle and drag distance sets tension;
releasing fires. Input is normalized so phone dimensions and pixel density do
not affect the simulation.

The phone shows immediate direction and tension feedback. Haptic pulse cadence
increases with tension, with a distinct pulse and local sound at maximum.
Haptics are feature-detected and degrade to visual and audio feedback. Audio is
unlocked by the player's first pointer gesture using the existing local-asset
policy.

The shared board shows one bow per player, a limited trajectory projection
while aiming, and static targets with three scoring rings. Targets remain
available after hits so players contest the same space. Arrows collide with
targets, field boundaries, temporarily lodged arrows, and other flying arrows.
Target hits add their ring value to the firing player's match score.

The initial host options are match duration, match count, reload delay, and
target layout seed. Wind, moving or destructible targets, ammunition types,
power-ups, phone motion controls, and additional weapons are deferred.

## Surfaces

### Host

The setlist builder can add either a question block or a minigame block. A bow
block exposes the four initial options. The play strip reads “Bow · match 1 of
2” and presents only the action valid for the current phase: **Start match**,
**Cancel match**, or **Next** after results. A disabled action explains its
dead end using the existing content rules.

### Player

The minigame replaces the normal buzzer area while its block is active. It
shows the synchronized countdown, full touch control, reload state, personal
match score, and connection status. Spectators and mid-match joiners see why
they cannot fire and when they can participate.

### Board

The field occupies most of the wall. Bows are arranged along the bottom and
carry player identity. Names and compact running scores stay close to their
bows rather than forming a separate dashboard. Results replace the field only
after the landing grace period and show all players before returning to the
normal standings flow.

Player identity colours identify bows and arrows. Target values and awarded
points use warm drama colours. Aim strength, angle marks, and trajectory guides
are measurements and use cyan. The separate visual design will decide exact
materials, silhouettes, hit effects, arrow deformation, motion curves, sound,
and feedback hierarchy through SVG comparisons and motion prototypes.

## Failure and recovery

- A stale input is ignored without changing the world. A duplicate release
  receives its original acknowledgment without creating another arrow.
- An input for an unknown minigame, player, or match is ignored and logged at a
  bounded rate.
- Invalid numeric input is rejected before it reaches the simulation.
- A board reconnect receives durable lifecycle state immediately and resumes
  on the next complete frame; it never becomes authoritative.
- A phone reconnect restores control for the same player on the next state and
  role frame.
- A runtime exception stops the match, returns it to ready, awards nothing, and
  reports a failure to the host. It does not take down the room server.
- A server restart during countdown or play restores the match as ready and
  awards nothing.
- Cancelling, changing blocks, undoing, or shutting down invalidates the active
  match identity and stops every timer before publishing the new state.

## Validation

Pure bow simulation tests use a seeded world and fixed inputs to cover
trajectories, ring scores, boundaries, flying-arrow collisions, lodged-arrow
collisions, expiry, reload rules, entity caps, and fixed-step consistency.

Runtime tests use fake clocks to cover synchronized start, deadlines, landing
grace, bounded catch-up, frame pacing, disconnect/reconnect, cancellation,
release acknowledgments, idempotent retry, and stale input or completion from
an old `matchId`. Deadline cases include a pre-deadline release arriving
during input grace, the same packet arriving after grace, and a release made
during countdown or reload.

Hub and legality tests prove that:

- start, cancel, result, undo, and next produce the correct explicit outcome;
- refused and unchanged actions alter no state, history, timer, or broadcast;
- a result creates one undo step and applies every player's points once;
- question actions cannot overlap a playing minigame;
- block advancement counts matches separately from questions.

Snapshot and setlist tests cover legacy question blocks, minigame option
sanitization, ready/results persistence, and interrupted-match restoration.
Projection tests verify board access to the shared field and phone access only
to personal control/result facts.

An integration server with temporary persistence, `tls: false`, and
`transcribe: null` drives several socket clients through countdown, releases,
completion, score commit, and undo. Client rendering uses the real-component
motion workbench where appropriate. Performance validation exercises the
expected game-night player count at the entity cap while ordinary state
messages are present. It records release-to-board latency and WebSocket
buffering rather than assuming transport is the bottleneck. Manual checks
cover actual-phone drag ergonomics, audio unlocking, haptic availability,
reconnection, multi-device synchronization, and board readability.

The completed change runs the focused tests, `npm test`, `npm run typecheck`,
and `npm run build`.

## Deferred visual design

The first implementation uses plain shapes, existing typography, and existing
color tokens only where they convey identity, measurement, or state. It does
not reproduce the exploratory artwork. After the mechanics are playable, the
following deserves a new design and review cycle:

- field composition, target and bow silhouettes, and depth treatment;
- target hit ownership, including identity-coloured ripple or glow studies;
- arrow flex, lodged-arrow response, deflection, and spring-like impact motion;
- trajectory appearance and crowding with several simultaneous aimers;
- draw, maximum-tension, release, collision, reload, and result feedback;
- sound and haptic recipes paired with each visual event;
- feedback priority when several impacts happen together;
- reduced-motion versions and performance fallbacks.

That process begins with a single coherent field, material, typography, and
motion direction. Only after that direction is accepted should it present
component variants or real-component motion scenarios.

## Deferred scope

- A dynamically loaded plugin system or generic game engine.
- Cross-device deterministic replay as a product feature.
- Persisting or undoing an in-progress physics world.
- Host adjudication of individual shots.
- Remote or hostile-client defenses beyond numeric and lifecycle validation.
- The detailed visual and microinteraction decisions listed above.
