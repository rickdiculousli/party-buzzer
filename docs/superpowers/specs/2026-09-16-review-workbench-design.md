# Review workbench design

Status: proposed implementation contract following the agreed conversation design.

## Purpose

Provide a local development loop: choose a frozen board/phone state, select
elements and write suggestions, send a batch to the user's current terminal
agent conversation, and refresh the same views after source changes.

Codex in a terminal is the first integration. Claude Code in a terminal is the
second. Submission must target the existing conversation, preserving its
context. It must not start a replacement agent or concurrently resume the same
conversation in another process.

## Constraints

- Use real Preact views, existing local assets, and design tokens.
- Keep game rules and semantic display selection in their existing owners.
- Previewing must not connect to or mutate a running room.
- Preserve phone redaction and explicit question/attempt identity.
- Keep development endpoints and review assets out of the production build.
- Preserve unrelated working-tree changes, including concurrent ink work.
- Use exact conversation IDs; never select the most recent conversation.
- Keep agent execution and approvals visible in the user's terminal.
- Submitted batches are immutable; subsequent edits create new drafts.

## User workflow

`npm run review` opens a local page. A scenario list sits beside a preview area
and notes panel. The preview shows a board, a phone, or both. The user can select
the phone's player and a viewport preset; each frame uses actual CSS viewport
dimensions, scaled only for fitting the workbench.

In Annotate mode, hovering outlines a target and clicking creates a numbered
pin with a text field. Selection intercepts clicks, including clicks on
disabled controls. Whole-screen notes and rectangular region notes cover
missing elements and canvas content. Draft notes survive page reloads.

The user pairs an exact Codex conversation ID once and sees it beside Send.
Send saves the current batch, captures its previews, then queues a message for
that conversation. The terminal remains the place to discuss, approve, and
observe the agent's work. The workbench displays submission and acknowledgment
status without pretending to be a second terminal client.

Refresh previews remounts the same scenario, player, viewport, and presentation
position while retaining the draft. The submitted bundle keeps its original
capture for the agent. The user resolves notes explicitly.

## Preview architecture

Create a sibling of `client/anim/`, rather than adding review controls to the
audio/motion tool. `review.html` and `review-frame.html` are development entries.
Use a dedicated Vite configuration for the review server so the agent bridge
is not enabled by ordinary `npm run dev` or the game server.

Mount the real board and player components with an explicit frozen fixture at
their socket boundary. Their production path retains sockets, audio, wake locks,
microphone access, timers, and action handlers; preview mode supplies fixed state
and suppresses those effects. Descendants such as `Spoken`, `Talk`, and reveal
timers receive inert preview inputs so they cannot restart timing or microphone
effects. This keeps one presentation tree without duplicating the large surface
components.

Fixtures specify role-projected State, player identity, fixed time, connection
status, pressed state, and explicit presentation values such as open, settled,
retired, and revealed transcript text. CSS animations are settled to a defined
frame after mounting. No global clock monkey-patching or second wall-priority
implementation is allowed.

Generate role fixtures through `Hub.viewFor` in a temporary, timer-cleaned-up
tool fixture; serve serialized results to the browser. Server modules stay out
of the browser bundle. Do not hand-maintain a second phone-redaction function.

Initial scenarios cover welcome, waiting, delay, question open, collection
before/after provisional reveal, leader answering, award, penalty hold,
rebound, phone lockout, duel selection, and setlist completion. A scenario can
offer multiple players, including leader, placed player, and spectator.
Minigame scenarios are a follow-on after the current ink implementation settles;
the first release does not modify ink components or invent a minigame framework.

## Annotation and capture

Each annotation records scenario, surface, player, viewport, text, and either a
target or region. Prefer explicit `data-review-id` markers on meaningful view
regions. Save a selector fallback, visible text, and frame-relative bounds as
supporting evidence. Repeated rows need IDs that include the player/score key.
Do not use CSS class names as stable identity or save whole DOM trees.

Drafts live in browser local storage, scoped by repository/workbench identity.
Submitted bundles live in ignored `.review/batches/<id>/` directories with a
versioned manifest, readable `request.md`, and PNG captures. Capture failure
keeps the draft and prevents submission of a misleading partial batch.

Use Playwright as a proposed development-only dependency for browser-accurate
PNG capture and browser regression checks. Install only Chromium. The browser
capture page receives the saved preview inputs and waits for local fonts,
images, and a deterministic ready signal. Include scroll position where
applicable. Pins are overlaid from saved bounds. Compare a preview/source
revision before and after capture; concurrent source changes require refresh
and recapture instead of silently pairing new pixels with old selections.

## Codex delivery

Read-only inspection on 2026-09-16 found local `codex-cli 0.154.0` exposes:

```sh
codex queue --thread <SESSION_ID> --message <TEXT>
```

This establishes command availability, not runtime delivery semantics. The
first implementation milestone verifies delivery to a designated test
conversation while idle and busy, behavior when unavailable, and whether
queueing to an inactive conversation starts work. Do not send probe messages
to an unrelated or automatically selected conversation.

The adapter invokes `codex` through an argument array with no shell, using the
explicit repository cwd and a UUID selected by the user. Send a compact
instruction with the absolute `request.md` path and batch ID. The request tells
the agent to inspect images, read repository instructions, preserve existing
changes, implement the notes, validate behavior, and report results.

Queue-command success sets Submitted only. The request supplies a local CLI
helper to acknowledge receipt, then mark the batch Ready for review or Blocked
with a summary. These are agent-reported states; completion is not independent
proof that tests passed. Validation details appear separately in the summary.

Persist the batch before delivery and record a submission attempt before
spawning the command. Double clicks return the same attempt. A timeout or
interrupted request is Delivery uncertain, not a retryable confirmed failure:
the command might already have queued the message. The UI offers an explicit
retry after the user checks the terminal. No exactly-once guarantee is claimed.

## Local bridge and concurrent work

Use a loopback-only review server with same-origin mutation checks. Endpoints
accept only known actions and batch IDs; browser input cannot select arbitrary
commands or filesystem paths. The bridge does not modify Codex permissions or
execute agent-generated commands. Local captures and delivery helpers belong
under `tools/review/`; keep `server/index.ts` unchanged.

Record the workspace HEAD and initial changed-file list for context, but do
not attribute all later working-tree changes to the review agent. While other
agents work, limit the request's scope and preserve their edits. Shared-file
conflicts require coordination; a dirty-file snapshot is not write isolation.
The workbench offers no automatic reset, checkout, or rollback button.

## Claude Code follow-on

Reuse the same batch format and acknowledgment helper. Deliver a local channel
event to the paired running Claude Code session. Channels require explicit
session startup configuration; installation alone does not activate delivery.
They are a research preview, so verify availability and custom-channel setup
against the installed version before implementation. Preserve the conversation
when restarting to enable the channel. No PTY keystroke injection is planned.

Reference: https://code.claude.com/docs/en/channels

## Acceptance

1. A selected state stays visually fixed without a game server or browser
   permissions, using production views and role-correct inputs.
2. Notes can target disabled controls, repeated rows, regions, and whole screens;
   drafts survive reload and missing targets never silently move.
3. One click delivers an immutable batch to the paired Codex conversation;
   submission errors and uncertain delivery preserve all notes.
4. Agent acknowledgment and completion are distinguishable from queue success.
5. Refresh shows updated source at the same scenario and presentation position;
   original images and unresolved notes remain available.
6. Regression tests protect role redaction, effect isolation, batch persistence,
   delivery idempotency, and annotation coordinates under viewport scaling.
7. Production build excludes review routes and bridge endpoints. Existing tests,
   typecheck, build, and affected motion scenarios pass or have explicit blockers.

Static previews validate appearance. Timing, microphone, audio, and multi-device
behavior still require their existing dedicated tests and manual checklist.
