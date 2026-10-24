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

<!-- bmesh:done -->
## Definition of done
A change is done when all of these hold: the repo's verify commands pass (`npm test`); a change sized M or larger (its spec's `size` as built: a change whose scope grew is sized by what it grew to, and work with no spec is sized as a spec would be (XS one file, S one module, M crosses modules, L changes an interface others depend on); at medium effort for M, high for L or larger) was reviewed once against its spec by Opus in a session that didn't write it and the findings were fixed, while an XS or S change is done on verify alone; the branch is rebased onto `main` with verify re-run; it is merged fast-forward to `main` and pushed to `rickdiculousli/party-buzzer`. If the rebase conflicts, resolve it: read your spec and the specs that landed since you branched, make every intent hold, widen your spec if a landed one changes what yours must look like, re-validate, then merge. Stop only when the widened scope can't be met from the specs alone; then report the block with `bmesh blocked` and the reason. End with one line: what's done (the commit on `main`), its push state from a fresh fetch (pushed, with the commit `origin/main` is at and that it contains yours, or not pushed and why), what wasn't checked, and what, if anything, waits on the operator. Say what each thing is: the first time a message names a spec, issue, PR, commit, job or numbered item, it says in plain words what that is, with the number after it in brackets if at all, so the operator never has to look anything up. The last line is final: it reads on its own, names nothing not explained above it, and says in plain words what waits on the operator and what they'd do about it.
<!-- /bmesh:done -->

<!-- bmesh:proposals -->
## Proposals
Half-page specs live in `docs/proposals/NNN-slug.md` (the template is `bmesh spec template`; the lifecycle is in `docs/proposals/README.md`). The build thread owns its spec's status: it sets `done` on its own branch, so the spec lands with its code; a build in flight, or blocked, is its lead's node on the mesh, never a status in git. Rejected specs stay so they aren't re-proposed. A spec the operator picks is built by a buildermesh lead (see Buildermesh below).
<!-- /bmesh:proposals -->

<!-- bmesh:mesh -->
## Buildermesh
Builds here run as nodes on a buildermesh mesh through the `bmesh` CLI: a lead owns one spec in its own worktree, executors build pieces on branches under the lead's and hand them back through the mesh, and routines run this repo's checks. The repo's routine kinds live in `.bmesh/routines/<kind>.toml` (`verify` runs `npm test`; `review` asks Opus, in a session that never saw the change, for findings; add a kind rather than a script when a check should be recorded). Commit before queueing a job: a job names a commit, and every result is recorded under that commit's tree hash, so a deterministic kind answers a repeat run from its record. A spec lands with its code, reading `done` in the tree that lands, and `bmesh land` rewords the landed commit to carry its proof as two trailers, `Spec: NNN` and `Verified: <entries>` (`verify ok t:<tree8>; review ok t:<tree8> m:<model>`), composed from the results recorded for the landed tree; `bmesh done` is the last word: it refuses until that commit is on `origin/main` with a result for every entry.
<!-- /bmesh:mesh -->

<!-- bmesh:rules core ponytail bcb4e187 -->
## Engineering rules
From bmesh's rule sets `core`, `ponytail`. Where the rest of this file says otherwise, the rest wins. Edit them freely: `bmesh scaffold` keeps an edited block and marks it customized.

### core
- Make the smallest change that solves the problem. Delete what's dead before adding.
- Read the code before you change it, and say what you learned before deciding.
- Fix the first place it went wrong, not where it showed. A guard is a fix only when the state it handles is legitimate.
- Prove it works on the real thing: run it the way a user would. Passing tests prove only what they reach.
- When two fixes have failed on the same assumption, stop and test the assumption.
- A rule you've had to state twice becomes a check or a script, not a third sentence.
- Do reversible work, then report it. Ask only what no experiment or reading can settle.
- Before trusting a number (a timing, a speedup, a count), find what limits it and rule out that it measured something else.

### ponytail
You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

**Before you write**

Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.

**The smallest complete change**

Take the first option that fully works:

1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.
- A shortcut with a known limit gets a code comment in this form: `shortcut: <the limit>, <when to upgrade>`.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.

From [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.2 by DietrichGebert (MIT).
<!-- /bmesh:rules -->
