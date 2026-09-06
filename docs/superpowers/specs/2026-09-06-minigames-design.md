# Minigames framework and bow proof of concept — design

Date: 2026-09-06

Party Buzzer gains setlist-native real-time minigames. Bow is the first
minigame and proves the framework with simultaneous phone controls, a shared
board field, server-authoritative physics, and one score commit at the end of
each match.

This document defines behavior and ownership. The visual language,
microinteractions, motion studies, and impact feedback belong in a separate
design document supported by comparative SVG studies.

## Decisions

- A minigame is a normal setlist block and contributes to the existing scores
  and standings.
- Minigames form a subsystem alongside question modes. They do not extend the
  question-mode hooks with continuous simulation concerns.
- Every bow match is simultaneous. All connected players fire into one shared
  field for 40 seconds by default.
- The server owns gameplay and scoring. Phones send intent; the board presents
  interpolated server frames.
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
module `act` channel. Its envelope contains the minigame id, `matchId`, a
monotonic player sequence, and minigame-specific input. Bow input consists of
normalized aim updates and a release command. The server validates the active
match, role, player participation, sequence, finite numeric bounds, and reload
eligibility before applying it.

Aim updates may be coalesced because only the latest direction and tension
matter. Releases are discrete and never coalesced. The phone renders its own
drag immediately; network updates do not sit in the finger-feedback path.

Simulation frames use a dedicated server message containing `matchId`, tick,
server time, and a role projection. The board receives the shared field.
Phones receive the lifecycle plus only the control and result facts relevant
to that player. Durable lifecycle changes still travel in ordinary state
messages.

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
a short reload. When `endsAt` arrives, new releases are refused. Arrows already
in flight receive a short, fixed grace period to land; the grace does not
permit new input. The server then freezes the field, calculates results, and
commits every player's earned target points together.

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

- A stale or duplicate input is ignored without changing the world.
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
grace, bounded catch-up, frame pacing, disconnect/reconnect, cancellation, and
stale input or completion from an old `matchId`.

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
expected game-night player count at the entity cap, and manual checks cover
actual-phone drag ergonomics, audio unlocking, haptic availability,
reconnection, multi-device synchronization, and board readability.

The completed change runs the focused tests, `npm test`, `npm run typecheck`,
and `npm run build`.

## Separate visual design

The following deserves its own design and review cycle before implementation:

- field composition, target and bow silhouettes, and depth treatment;
- target hit ownership, including identity-coloured ripple or glow studies;
- arrow flex, lodged-arrow response, deflection, and spring-like impact motion;
- trajectory appearance and crowding with several simultaneous aimers;
- draw, maximum-tension, release, collision, reload, and result feedback;
- sound and haptic recipes paired with each visual event;
- feedback priority when several impacts happen together;
- reduced-motion versions and performance fallbacks.

That process should present two or three comparative SVG treatments for each
material decision, including key animation frames where motion carries the
meaning. Approved studies become the source for a visual/microinteraction spec
and real-component motion scenarios.

## Deferred scope

- A dynamically loaded plugin system or generic game engine.
- Cross-device deterministic replay as a product feature.
- Persisting or undoing an in-progress physics world.
- Host adjudication of individual shots.
- Remote or hostile-client defenses beyond numeric and lifecycle validation.
- The detailed visual and microinteraction decisions listed above.
