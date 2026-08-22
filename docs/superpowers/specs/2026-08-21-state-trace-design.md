# State trace: a debugger tap for agents

Date: 2026-08-21
Status: approved (approach 1, user directive 2026-08-21)

## Problem

Agents hunting display/state bugs (the class `shared/wall.ts` exists to kill:
wrong occupant, wrong moment, stale phase) today drive `probe` or `sim` and then
read full `State` JSON dumps. Snapshots are big, 95% unchanged between frames,
and answering "how did the room get here" means diffing them by eye — a token
bonfire per investigation.

## Design

Two halves: a tap in the server that records, a CLI that reads. The CLI carries
all the intelligence so the server change stays tiny.

### The tap (`server/trace.ts` + one hook in `server/hub.ts`)

- `Hub.changed()` is the single funnel every mutation and buzz arrival already
  flows through before broadcast. It gains an optional `cause` label
  (`changed('arm')`, `changed('buzz')`, …) — present tense, naming the message
  or timer that mutated.
- The tap appends one JSON line per call to `trace.jsonl` (repo root,
  gitignored): `{seq, t, cause, moment, state}` where `moment` is
  `momentOf(state, local)` computed with the hub's own timing facts
  (`open`/`settled`/`retired`), so the timeline speaks the same vocabulary as
  the wall bugs it exists to catch.
- Recording is gated on `TRACE=1` in the environment. Off means zero overhead:
  no clone, no file handle. On means the full (unredacted, board-view) state is
  `structuredClone`d per frame — the clone is what makes replay safe against
  later in-place mutation.
- The file rotates by truncation at server start when tracing is on: a trace is
  one investigation, not an archive.
- ponytail: append-per-frame with no size cap. A game night at TRACE=1 writes
  maybe tens of MB; if that ever matters, rotate by size.

### The CLI (`tools/trace.ts`, `npm run trace -- …`)

Reads `trace.jsonl`, diffs consecutive frames, prints compactly. Diffing is a
leaf-flatten of both states (`round.phase`, `scores.Ada`) with added/removed/
changed leaves; unchanged subtrees print nothing.

- bare: the timeline. One line per frame:
  `#12 +341ms buzz COLLECTING verdict:none order+Ada@0`
  — seq, ms since previous frame, cause, phase, moment, then the leaf diff
  compressed (paths shared where prefixes match).
- `--full N`: the complete state at frame N, pretty-printed. The escape hatch.
- `--watch path[,path]`: only frames where those leaves changed, printed as
  `path: old→new` columns. "Show me every time `round.held` moved."
- `--moment X`: only frames whose moment is X (e.g. `--moment verdict:wrong`).
- `--since N` / `--until N`: frame range.
- `--round`: collapse to one line per round (value, phases entered, order,
  verdicts) — the ten-token answer to "what happened in that game".

No server round-trip, no new protocol message: the CLI is a file reader, so it
works against a trace from a dead server, a copied file, or CI.

## What it deliberately is not

- Not time-travel: the tap observes, it cannot rewind the live hub. Undo already
  exists for that.
- Not per-phone: frames record the unredacted state. Redaction bugs are tested
  in `hub.test.ts`, not traced.
- No UI. If a human wants to watch one, that's a board feature and a different
  spec.

## Testing

- `server/trace.test.ts`: tap writes nothing with TRACE unset; one line per
  `changed()` with it set; moment matches `momentOf` of the frame's state.
- `tools/trace.test.ts`: diff of two synthetic states produces the expected
  leaf changes; `--watch` filters; the timeline line compacts a multi-leaf
  round correctly.
- Manual: `TRACE=1 npm start` + a probe round, then `npm run trace` reads it.

## Files

- new `server/trace.ts` — the tap (writer)
- new `tools/trace.ts` — the CLI (reader/differ)
- `server/hub.ts` — `cause` param on `changed()`, tap call
- `package.json` — `trace` script
- `.gitignore` — `trace.jsonl`
- `CLAUDE.md` — commands + one paragraph in Verifying
