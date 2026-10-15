# Working in party-buzzer

## Scope and starting points

This is a hobby project for a trusted LAN. Every user-facing role uses the web
UI: player `/`, host `/host`, board `/board`. Optimize for convenient game
nights and understandable code. Authentication, hostile-client defenses,
remote services, and a general plugin framework are not default requirements.

Read [ARCHTECTURE.md](ARCHTECTURE.md) for the component map. From
[README.md](README.md), read only [Saving and undo](README.md#saving-and-undo)
and [Development](README.md#development) (those two sections). Read the
[design guide](docs/design.md) by section and task: §9, “Canon words,” for any
naming; §4 and §5 only when touching components or motion; §7 for surface
layout. Use the canon vocabulary consistently: question, round, attempt, block,
setlist, order, standings, leader, and hero describe different things.

Historical plans under `docs/superpowers/` are context, not current contracts.
Inspect actual call sites and tests before changing an established boundary.

## Implementation boundaries

- `server/index.ts` wires services. Keep game rules in their owning modules.
- `Hub.dispatch` commits host actions. Preserve explicit applied, unchanged,
  refused, and failed outcomes; a refusal or no-op must not change history,
  timers, or broadcast state.
- `shared/legality.ts` owns shared host-action legality. Do not reproduce a
  second rules ladder inside host components.
- `shared/wall.ts` owns semantic display moments and projections. Do not add
  independent moment priorities to each surface or put DOM, clocks, CSS
  colors, or browser effects into those pure functions.
- Modes use typed options and memory through `shared/modes/types.ts`. Expose
  mode-specific host information through `hostStatus`; keep concrete mode
  branches out of host and player components. Mode hooks return item grants;
  the item framework executes them.
- Keep scoring primitives in `shared/scoring.ts`. Items, duels, and setlists
  belong to their own framework modules rather than a particular mode.
- Distinguish `questionId` from `attemptId`. Rebounds keep the question but
  replace the attempt. Scope asynchronous work to the appropriate identity
  and cancellation signal; timestamps and fragment counts are not identity.
- `State` is the live model, not a disk format. Update `server/snapshot.ts`
  deliberately when adding fields. Decide whether each field belongs in
  undo, durable state, role projections, or private runtime memory.
- Preserve phone redaction in `viewFor`. Display-moment selection must work
  from facts available to every role; a phone does not have the full order or
  private reader progress.

Prefer a small explicit function or static registry over new abstractions
(no event bus, container, or framework) and treat new dependencies as a project
decision.

## Runtime and UI conventions

Node is pinned in `mise.toml`. Server TypeScript runs through Node's type
stripping, with `.ts` relative imports. Avoid syntax requiring TypeScript
transformation, such as enums and constructor parameter properties.

Preact renders the three browser surfaces. Each surface owns its socket through
`useSocket`; keep browser lifecycle and timing effects out of shared rules.
Use local fonts and sounds from `client/public/`; do not add CDN/runtime asset
fetches. Certificate retrieval and DNS are infrastructure exceptions, not a
pattern for fetching UI resources.

Use the design tokens and existing components. For motion or sound changes,
use `npm run motion` and its real-component scenarios. For interest and feedback
motion, use the interest kit (`fx-*` classes and `client/fx.tsx`; design guide
§4) before writing a new keyframe. Audio tunables read the
scene's scope rather than always reading the document root. Keep CSS tunables,
JavaScript defaults, and cue recipes consistent. Workbench save/adopt endpoints
write source files; inspect their diff. Adopted audio belongs in
`client/public/sounds/` with credits, never in ignored `sounds/raw/`.

Before calling motion, visuals or sound done, run the repository
`adversarial-qa` skill: evidence from `tools/qa/` (kinematics, filmstrips,
sound character) goes to fresh critic agents, whose verified findings are fixed or reported.

For frozen board or phone review, use the repository `review-workbench` skill.
It owns launch, annotation-batch handling, and the boundary between static visual
evidence and live behavior. When a normal review desire requires repeated ad hoc
tool work, finish the request and propose the smallest workbench, script, or skill
improvement that would make that path ordinary.

## Validation

Keep tests light: cover pure logic that could silently go wrong, including
timing or stale-work cases where relevant. Skip tests for glue and UI.

```sh
node --test server/resolve.test.ts   # focused example
npm test                           # all five test locations
npm run typecheck
npm run build
npm run test:review                # layout fit check, every review scenario; about a minute
```

`npm test` includes server, server/modes, client, shared, and tools tests.
After a UI change, run `npm run test:review` in full; it fits well inside a
command's ten-minute limit, so don't trim it to a few scenarios.
A server-only glob misses coverage. A fresh worktree has no `node_modules`; run
`npm ci` first.
The first `npm run typecheck` in a fresh worktree is a full check (slow) and writes
`cache/tsbuildinfo`; later runs are incremental and take a few seconds.

Use injected speech, alignment, and transcription fakes for deterministic
logic tests. Integration servers should use temporary persistence and
`tls: false, transcribe: null` when native/network boot is not under test.
Local socket tests need permission to bind; native speech tests may depend on
macOS tools.

`npm start` serves the build in `dist/` and does not watch server changes.
Vite's proxy currently supports an HTTP backend on 8080 and omits `/spoken`;
see the architecture guide before using HMR to test connected behavior.
Simulation and walkthrough commands mutate the running room. Use a disposable
room for them. Validate microphone, playback, and multi-device behavior with
[the manual checklist](docs/manual-checklist.md) when affected.

## Keep documentation useful

- `README.md`: installation, running, gameplay, and practical limitations.
- `ARCHTECTURE.md`: current component ownership, wiring, invariants, extension paths.
- `AGENTS.md`: common working instructions for every agent, Claude Code included.
  Keep it the only one: Claude Code reads it only while no `CLAUDE.md` exists.
- `docs/design.md`: visual language and terminology.
- `docs/question-styles/`: writing rules per question style, plus shared accepted-answer rules.

Update the relevant guide when changing its contract. Avoid pinning test
counts or duplicating long source-level API inventories in prose.

<!-- command-center:done -->
## Definition of done
A change is done when all of these hold: the repo's verify commands pass (`npm test`); a validation agent that didn't write the change reviewed it against its spec and the findings were fixed; the branch is rebased onto `main` with verify re-run; it is merged fast-forward to `main` and pushed to `rickdiculousli/party-buzzer`. If the rebase conflicts, resolve it: read your spec and the specs that landed since you branched, make every intent hold, widen your spec if a landed one changes what yours must look like, re-validate, then merge. Stop only when the widened scope can't be met from the specs alone; then mark your spec `blocked` with the reason, push, and report. End with one line: what's done (commit on main) and what, if anything, waits on Rick.
<!-- /command-center:done -->

<!-- command-center:proposals -->
## Proposals
Half-page specs live in `docs/proposals/NNN-slug.md` (template and lifecycle in `command-center/templates/proposal.md`). The build thread owns its spec's status: `building` when dispatched, `done` with the merge SHA when merged, `blocked` with a reason if it can't finish. Rejected specs stay so they aren't re-proposed. Accepted specs are built by buildermesh leads (see Buildermesh below).
<!-- /command-center:proposals -->

<!-- command-center:mesh -->
## Buildermesh
Builds here run as nodes on a buildermesh mesh through the `bmesh` CLI: a lead owns one spec in its own worktree, executors build pieces on branches under the lead's and hand them back through the mesh, and routines run this repo's checks. The repo's routine kinds live in `.bmesh/routines/<kind>.toml` (`verify` runs `npm test`; `review` asks a model of another family for findings; add a kind rather than a script when a check should be recorded). Commit before queueing a job: a job names a commit, and every result is recorded under that commit's tree hash, so a deterministic kind answers a repeat run from its record. A spec is done only when its frontmatter carries a `verified` line (`verify ok t:<tree8>; review ok t:<tree8> m:<model>`), composed by `bmesh spec verified --write` from the results recorded for the landed tree, and `bmesh done` is the last word: it refuses until the spec on `origin/main` reads `done` with a merged commit and a result for every entry.
<!-- /command-center:mesh -->
