# Review Workbench Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Keep execution inline unless parallel agent work is explicitly requested.

**Goal:** Annotate frozen production board/phone previews, send batches to the user's current Codex terminal conversation, and refresh after edits.

**Architecture:** A development-only Preact workbench renders shared presentation components in isolated frames. A local Vite bridge persists capture bundles and delivers their paths with `codex queue`; the existing agent reports receipt and completion through a local helper.

**Tech Stack:** Existing Node TypeScript, Preact, Vite, Node test runner; proposed development-only Playwright/Chromium for screenshots and browser tests.

**Spec:** [Review workbench design](../specs/2026-09-16-review-workbench-design.md)

## Global constraints

- Use real Preact views, existing local assets, and design tokens.
- Keep game rules and semantic display selection in their existing owners.
- Previewing must not connect to or mutate a running room.
- Preserve phone redaction and explicit question/attempt identity.
- Keep development endpoints and review assets out of the production build.
- Preserve unrelated working-tree changes, including concurrent ink work.
- Use exact conversation IDs; never select the most recent conversation.
- Keep agent execution and approvals visible in the user's terminal.
- Submitted batches are immutable; subsequent edits create new drafts.

This plan implements the Codex release. Claude channel support and minigame
fixtures are separate follow-ons with the same bundle contract. Before editing,
re-read actual call sites: the parallel ink task can change shared entry points.
Do not restore files to the contents observed during planning.

## File responsibilities

| Files | Responsibility |
| --- | --- |
| `client/Board.tsx`, `client/Player.tsx` | Preserve connected runtime wrappers |
| `client/BoardView.tsx`, `client/PlayerView.tsx` | Shared controlled presentation |
| `client/Spoken.tsx`, `client/Talk.tsx` | Split presentation/effects only where required for fixed previews |
| `client/review/model.ts` | Serializable scenario, annotation, and bundle contracts |
| `client/review/main.tsx`, `frame.tsx`, `review.css` | Workbench and isolated scene renderer |
| `client/review/selection.ts`, `drafts.ts` | Element/region targeting and draft persistence |
| `client/review.html`, `client/review-frame.html` | Development entry documents |
| `tools/review/fixtures.ts` | Generate role-projected scenario inputs through Hub |
| `tools/review/batches.ts`, `capture.ts`, `codex.ts`, `plugin.ts`, `report.ts` | Local storage, PNG capture, queue adapter, endpoints, acknowledgment helper |
| `vite.review.config.ts` | Dedicated loopback review server configuration |
| `tools/review.test.ts`, `client/review.test.ts` | Node regression checks included by existing test globs |
| `tools/review/browser.spec.ts`, `playwright.review.config.ts` | Browser integration coverage |

## Task 1: Verify delivery before building the UI

**Files:** Create `tools/review/codex.ts`, `tools/review.test.ts`; record results in this plan.

**Interface:** `queueBatch(input, run): Promise<void>` consumes an explicit thread
UUID, cwd, batch ID, and absolute request path. `run` is an injected process
runner accepting executable, argument array, and cwd. It rejects nonzero exit,
spawn failure, and timeout distinctly. It never retries internally.

- [x] Inspect `codex --version` and `codex queue --help` again. Match the installed
  command contract; the planning observation was version 0.154.0.
- [x] Add a runner-fake test that passes suggestion text containing backticks,
  quotes, `$()`, and newlines. Assert the text is a single argument to `codex`,
  the thread UUID is exact, and the cwd is the requested repository.
- [x] Run `node --test tools/review.test.ts` and confirm the new test fails.
- [x] Implement the adapter with `execFile` or `spawn` without a shell:

  ```ts
  await run('codex', [
    'queue', '--thread', input.threadId,
    '--message', `Review batch ${input.batchId}. Read ${input.requestPath}.`,
  ], { cwd: input.cwd })
  ```

- [x] Add failure tests for missing binary, invalid thread, nonzero exit, and
  timeout; expose bounded diagnostic output without discarding the saved batch.
- [x] Send a harmless batch to the user-designated conversation while busy. Check
  transcript placement, interruption/queue behavior, and receipt.
- [ ] Send the same harmless acknowledgment probe while that conversation is idle.
- [x] Test an unavailable designated session. Determine whether the CLI starts
  work for inactive threads; if it does, require an active-session preflight using
  supported session APIs before accepting Send. If that cannot be established,
  stop this milestone and report the limitation rather than substituting resume.
- [x] Record the observed contract here and rerun focused tests. Do not proceed
  to UI integration until the active-conversation requirement is demonstrated.

### Delivery observations, 2026-09-16

- Local `codex-cli 0.154.0` accepts an exact thread UUID through `codex queue`.
- A syntactically valid UUID with no rollout is rejected with a nonzero exit;
  it does not create or resume a conversation.
- A probe sent while the designated conversation was processing a turn returned
  success and a queued-message UUID, then appeared as the next inbound message
  after that turn. It did not interrupt the active response.
- An unknown conversation is rejected instead of being created or resumed. The
  intended target is the exact open conversation supplied by the user. A known
  but closed conversation and delivery while an open conversation is idle were
  not exercised; expose delivery as queued until the agent acknowledges it.
- The CLI needs access to its local state database under `~/.codex`; a sandbox
  that makes that database read-only fails before it reaches session lookup.

## Task 2: Extract controlled views and render fixed scenarios

**Files:** Shared views and runtime wrappers listed above; `client/review/model.ts`,
`frame.tsx`, `tools/review/fixtures.ts`, `client/review-frame.html`, dedicated Vite
configuration, `package.json`, browser test configuration.

**Interface:** Export `BoardView` and `PlayerView` with explicit role-projected
State and presentation props. Export `PreviewInput` containing scenario ID,
surface, player ID, viewport, fixed time, role State, and local presentation.
Frame URL selects a fixture by ID; a capture request can select a saved input.
The frame signals `review:ready` only after fonts/images settle and its fixed
presentation frame has been applied.

- [ ] Read `Board`, `Player`, `Spoken`, `Talk`, `useReveal`, `useSocket`, and
  `shared/wall.ts`. List effectful descendants before moving JSX. Leave minigame
  registry branches in their existing runtime wrappers for this release.
- [ ] Add a browser test that loads a frozen leader-answering phone, rejects any
  `/ws` connection or `/spoken` request, and fails on microphone/audio activation.
- [ ] Add projection tests using the existing Hub fixture setup. Assert phones
  omit other players' order entries, `round.whole`, and private reading progress;
  include mirrored/unmirrored text cases.
- [ ] Extract JSX into shared views, passing callbacks from the production
  wrappers and inert callbacks from previews. Pass revealed transcript text into
  controlled transcript presentation; keep transcript timing in its runtime owner.
  Preserve keys governing hero arrival and existing CSS wrappers.
- [ ] Define static scene builders with fresh question/attempt IDs and generate
  role views with `Hub.viewFor`. Close fixture timers after generation. Serve
  fixture JSON from the local tool instead of importing Hub into browser code.
- [ ] Add all initial scenarios named in the spec. Use a fixed display clock and
  local presentation props; settle CSS animation timelines to an explicit point.
- [ ] Add `npm run review` for the dedicated loopback Vite configuration. Add the
  proposed Playwright dev dependency and a separate `test:review` script, keeping
  browser tests outside Node's existing globs. Include `vite.review.config.ts` in
  TypeScript checking; Node tests still directly exercise `tools/` utilities.
- [ ] Run Node projection tests and the browser isolation test. Compare normal
  board/phone rendering after extraction, then run `npm test`,
  `npm run typecheck`, and `npm run build`. Exercise affected `npm run motion`
  scenarios because moving presentation can alter animation lifetimes.

## Task 3: Select elements and preserve annotation drafts

**Files:** `client/review/main.tsx`, `selection.ts`, `drafts.ts`, `review.css`,
`client/review.html`, shared view markers, `client/review.test.ts`, browser tests.

**Interface:** `Annotation` contains ID, text, PreviewInput reference, target ID
or selector evidence, frame-relative bounds/scroll position, and resolution
status. `ReviewDraft` contains selected previews and annotations. Draft load/save
uses a versioned storage key scoped to the workspace ID returned by the server.

- [ ] Add failing tests for persistence across reload, a missing target, duplicate
  target IDs, and annotation coordinates when the visible iframe is scaled.
- [ ] Build the scenario list, board/phone toggles, player picker, viewport presets,
  and note editor. Encode selected scenario/player/viewport in the page URL.
- [ ] Add stable `data-review-id` values to meaningful view regions; repeated
  standings rows include their score key. Resolve a saved target only if unique.
- [ ] Install capture-phase pointer interception inside preview frames. Outline
  hovered targets without changing layout; Escape cancels selection. Annotating
  a disabled buzzer creates a note and never invokes its callback.
- [ ] Implement rectangular region and whole-screen notes. Convert coordinates
  to the frame's CSS-pixel space and retain scroll offsets. Canvas selection uses
  regions rather than invented DOM identities.
- [ ] Persist drafts after edits; expose storage errors while retaining in-memory
  notes. On refresh, label absent/ambiguous targets unlocated and keep their text.
- [ ] Run `node --test client/review.test.ts` and browser selection tests, including
  scrolling a phone and selecting a repeated standings row.

## Task 4: Persist immutable batches and capture evidence

**Files:** `tools/review/batches.ts`, `capture.ts`, `plugin.ts`, `.gitignore`,
`tools/review.test.ts`, browser tests, shared review contracts.

**Interface:** `createBatch(draft): Promise<Batch>` writes a versioned manifest,
request Markdown, and PNGs below `.review/batches/<id>/`. `Batch` includes a UUID,
target conversation, captured preview inputs, workspace/source revision evidence,
and annotations. Delivery status is mutable metadata outside the immutable payload.

- [ ] Add temp-directory tests: batch survives process recreation; a second write
  cannot replace an existing payload; malformed IDs cannot escape the batch root;
  failed capture leaves the draft available and creates no submitted batch.
- [ ] Create files in a staging directory, capture all required images, and rename
  into place only after success. Use generated UUIDs for directory names.
- [ ] Capture saved inputs in Chromium at exact viewport/scroll dimensions. Wait
  for `review:ready`, then write PNGs and overlays from annotation coordinates.
- [ ] Compare source revision at selection/capture and after capture. If changed,
  return an explicit recapture requirement. Test this with an injected revision
  provider so no test edits unrelated source files.
- [ ] Generate `request.md` containing notes grouped by preview, image paths,
  reproduction URLs, source hints, existing changed-file context, validation
  expectations, and acknowledgment instructions. Do not claim changed-file context
  isolates or proves ownership of concurrent edits.
- [ ] Add local endpoints for fixture retrieval, batch creation/status, and saved
  captures. Validate same-origin mutations and known IDs; do not accept arbitrary
  paths or executable strings. Enable these only in the dedicated review config.
- [ ] Ignore `.review/`. Run Node storage tests and browser screenshot checks with
  local fonts, scroll offsets, and a source-change rejection case.

## Task 5: Connect Send, acknowledgment, and refresh

**Files:** `tools/review/plugin.ts`, `report.ts`, `batches.ts`, `codex.ts`,
`client/review/main.tsx`, Node and browser tests.

**Interfaces:** Delivery status is one of `saved`, `submitting`, `submitted`,
`delivery-uncertain`, `delivery-failed`, `acknowledged`, `ready`, `blocked`.
`report.ts <batch-id> <acknowledged|ready|blocked> [summary-file]` updates mutable
status with validated transitions and an optional text summary.

- [ ] Add failing tests: simultaneous Send requests launch one queue command;
  a timeout stays uncertain; acknowledgment arriving before command exit is not
  overwritten by Submitted; duplicate acknowledgment is harmless; a stale report
  for another batch cannot complete the currently displayed one.
- [ ] Persist a submission attempt before calling the Codex adapter. Return the
  existing attempt for duplicate requests. On restart, unresolved Submitting
  becomes Delivery uncertain; do not automatically deliver again.
- [ ] Add pairing by exact thread UUID and visible target label. Follow Task 1's
  observed active-session checks. Disable submission while this target already
  has an outstanding workbench batch; allow additional draft notes.
- [ ] Include the report commands in the request. Keep Ready for review distinct
  from independent validation and user-resolved notes. Display failure/blocked
  summaries without deleting payloads or drafting an automatic replacement task.
- [ ] Poll batch status from the UI. Show explicit retry only for confirmed
  failures; uncertain delivery requires checking the terminal before retry.
- [ ] Implement Refresh previews by remounting frames with saved selection and
  fixed presentation inputs. Preserve note drafts outside Vite component state.
  Show original captures beside current previews and explicit Resolve controls.
- [ ] Run focused tests and one end-to-end batch against the designated Codex
  conversation. Verify acknowledgment, terminal approval visibility, a small
  intended edit, reported validation, and refresh of the same state.

## Task 6: Validate and document operation

**Files:** `README.md`, `ARCHTECTURE.md`, `docs/manual-checklist.md`, tests as needed.

- [ ] Document launch, Chromium setup, pairing, Send, acknowledgment states,
  retry semantics, refresh, ignored artifacts, and the Codex version actually
  tested. Explain that the agent continues in the existing terminal.
- [ ] Document view/runtime ownership and development-only routes. State that
  static previews do not prove timing, speech, microphone, or multi-device behavior.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:review`.
  Run affected motion scenarios and relevant manual-checklist entries. Report
  socket-binding/native-tool blockers precisely instead of claiming a full pass.
- [ ] Inspect `dist/` and verify review HTML, tools, and delivery endpoints are
  absent. Verify production routes still operate normally.
- [ ] Run `git diff --check` and inspect only task-owned changes. Report shared-file
  conflicts without resetting concurrent ink work. Present the completed Codex
  release and its observed delivery limitations before starting Claude support.

## Follow-on: Claude Code terminal adapter

Use the documented local channel protocol to deliver the same saved request
into the paired conversation. First verify custom-channel availability in the
installed Claude Code version and the steps to enable it while preserving the
conversation. Test idle/busy delivery, acknowledgments, disabled-channel feedback,
and duplicate handling. Keep channel configuration explicit; never switch to a
second headless agent or terminal keystroke injection. Write its bounded plan
after the Codex batch/report contract has been exercised.
