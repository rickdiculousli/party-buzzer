# Working in party-buzzer

## Scope and starting points

This is a hobby project for a trusted LAN. Every user-facing role uses the web
UI: player `/`, host `/host`, board `/board`. Optimize for convenient game
nights and understandable code. Authentication, hostile-client defenses,
remote services, and a general plugin framework are not default requirements.

Read [ARCHTECTURE.md](ARCHTECTURE.md) for the component map and
[README.md](README.md) for operation. Before naming concepts or changing UI,
read [the design guide](docs/design.md), especially §9, “Canon words.” Use its
vocabulary consistently: question, round, attempt, block, setlist, order,
standings, leader, and hero describe different things.

Historical plans under `docs/superpowers/` are context, not current contracts.
Inspect actual call sites and tests before changing an established boundary.
Preserve unrelated working-tree changes. Keep each requested task bounded,
finish its validation, and report what changed and any remaining limitations.

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

Prefer a small explicit function or static registry over a new abstraction.
Do not introduce an event bus, dependency container, storage layer, or framework
just to connect existing components. Evaluate new dependencies as a deliberate
project decision.

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
use `npm run motion` and its real-component scenarios. Audio tunables read the
scene's scope rather than always reading the document root. Keep CSS tunables,
JavaScript defaults, and cue recipes consistent. Workbench save/adopt endpoints
write source files; inspect their diff. Adopted audio belongs in
`client/public/sounds/` with credits, never in ignored `sounds/raw/`.

## Validation

For behavior changes, add meaningful regression tests and validate after each
completed task before proceeding to another. Test outcomes and boundaries,
including timing or stale-work cases where relevant, rather than duplicating
the implementation in assertions.

```sh
node --test server/resolve.test.ts   # focused example
npm test                           # all five test locations
npm run typecheck
npm run build
```

`npm test` includes server, server/modes, client, shared, and tools tests.
A server-only glob misses coverage. The TypeScript project does not explicitly
include `tools/`, so typecheck alone does not validate every utility.

Use injected speech, alignment, and transcription fakes for deterministic
logic tests. Integration servers should use temporary persistence and
`tls: false, transcribe: null` when native/network boot is not under test.
Local socket tests need permission to bind; native speech tests may depend on
macOS tools. Report blocked or skipped checks accurately.

`npm start` serves the build in `dist/` and does not watch server changes.
Vite's proxy currently supports an HTTP backend on 8080 and omits `/spoken`;
see the architecture guide before using HMR to test connected behavior.
Simulation and walkthrough commands mutate the running room. Use a disposable
room for them. Validate microphone, playback, and multi-device behavior with
[the manual checklist](docs/manual-checklist.md) when affected.

For documentation-only changes, check source claims, paths, commands, links,
and `git diff --check`; a full behavioral suite is not required unless code
also changes.

## Keep documentation useful

- `README.md`: installation, running, gameplay, and practical limitations.
- `ARCHTECTURE.md`: current component ownership, wiring, invariants, extension paths.
- `AGENTS.md`: common working instructions; `CLAUDE.md` points here.
- `docs/design.md`: visual language and terminology.

Update the relevant guide when changing its contract. Describe the current
implementation, distinguish limitations from intended behavior, and avoid
pinning test counts or duplicating long source-level API inventories in prose.
