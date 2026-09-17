---
name: review-workbench
description: Use when the user wants to inspect, annotate, compare, or iterate on frozen party-buzzer board or phone states, or when a message names a saved review batch to acknowledge and implement. Do not use static previews as evidence for timing, audio, microphone, networking, or multi-device behavior.
---

# Review workbench

Use the workbench as the visual feedback loop for board and phone presentation.
The user supplies intent through annotations; apply judgment to the real product
and keep deterministic mechanics in the workbench commands.

## Choose the mode

- **Launch:** the user wants to see, inspect, annotate, compare, or iterate on a
  board or phone state.
- **Batch:** the message says `Review batch <uuid>. Read <path>.` or the user asks
  to continue work submitted by the workbench.
- **Workbench improvement:** the user is asking for a capability of the review
  loop itself. Treat that as product work on `client/review/` or `tools/review/`,
  rather than faking the result in a fixture or prompt.

Use the live app and `docs/manual-checklist.md` when the question depends on
clocks, motion, speech, sound, microphones, sockets, or multiple devices.

## Launch a review

1. Read the Review workbench section in `README.md` if operation may have
   changed. Do not start the game server; frozen previews are isolated from it.
2. For a user-facing launch, run `npm run review`. For an agent-controlled PTY,
   run `npm run review:serve` and report
   `http://127.0.0.1:4174/review.html`.
3. Install Chromium with `npx playwright install chromium` only when launch or
   capture reports that the browser executable is missing. Do not make every run
   pay the installation step.
4. Tell the user to choose a scenario and phone, click preview elements, write
   suggestions, and press **Send**. Leave the server running during iteration;
   stop only the process you started when the user is finished or asks you to.

The current Send adapter targets an exact Codex conversation. Claude Code can
launch the workbench and process a pasted batch, but it must not claim that the
button can inject into a busy Claude conversation until a supported Claude
delivery adapter has been implemented and verified.

## Process a batch

1. Confirm the message UUID matches the directory name and the request resolves
   beneath `.review/batches/<uuid>/`. Never accept an arbitrary request path.
2. Read `request.md` and `manifest.json`, inspect every capture referenced by an
   open note, and note the saved source revision and pre-existing changed files.
3. Before editing, run:

   ```sh
   node tools/review/report.ts <batch-id> acknowledged
   ```

4. Interpret the annotation in its visual and product context. Decide whether it
   calls for production UI behavior, a fixture correction, a workbench feature,
   or validation the static harness cannot provide. Change the owning code; do
   not make a fixture lie to produce the requested pixels.
5. Preserve unrelated working-tree changes. Validate the affected behavior and
   use **Refresh previews** to inspect the same frozen state after edits.
6. Put the result and validation in a temporary summary file, then run one of:

   ```sh
   node tools/review/report.ts <batch-id> ready /absolute/path/summary.txt
   node tools/review/report.ts <batch-id> blocked /absolute/path/reason.txt
   ```

A delivery-only probe may go from acknowledged to ready after capture inspection
without changing source. A real blocker gets `blocked`; uncertainty or a missing
optional enhancement does not.

## Turn repeated judgment into normal functionality

Notice the path the user was trying to take, including paths attempted through
an LLM tool call. If completing an ordinary review desire required custom shell
commands, one-off browser scripting, manual relaying, reconstruction from files,
or repeated model judgment, ask whether that step belongs in the normal
workbench rather than remaining agent folklore.

Treat the path as a normal-functionality candidate when the user asks for it as
if the workbench already supports it, the same fallback recurs, or the model has
to reconstruct an operation the saved batch already contains enough data to do.
Ordinary source investigation and one-off design judgment remain agent work;
their mere use of tools is not evidence that the workbench needs another button.

Finish the requested review first. Then, when the evidence indicates a reusable
gap, include one concise **Workbench improvement** proposal containing:

- the user desire that exposed the gap;
- the manual or LLM-mediated fallback used;
- the smallest likely home: UI, fixture, endpoint, deterministic script, or this
  skill's instructions;
- one observable check that would prove the improvement works.

Prefer product UI for a user interaction, a script for repeatable mechanics, and
skill text for judgment or routing. Propose changes to this skill or its commands
when its instructions were missing, stale, or caused needless improvisation.
Do not silently expand a review batch into harness development, and do not emit a
generic improvement section when the normal path already worked.

## Validate the workflow

- `npm run test:review` covers preview isolation, annotation persistence, Send,
  and Refresh.
- `node --test client/review.test.ts tools/review.test.ts` covers drafts,
  projections, immutable batches, delivery, and reporting.
- Use the repository's normal validation rules for production changes.
