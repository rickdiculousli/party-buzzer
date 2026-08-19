# Canon words — a disambiguation pass

**Status: stub. Not designed.** This records the problem and the evidence while
both are fresh. It needs its own brainstorm before anyone writes code.

## Why

The repo has grown several words that mean two or three things, and at least
one concept with three or four words for it. `CLAUDE.md` already stops to warn
about one of them — *"Two different things are called 'mode'"* — which is the
tell that this is a documented workaround rather than a naming scheme.

The cost is not aesthetic. Drawing the wall boundary
(`2026-08-18-wall-boundary-design.md`) rejected `Stage` for the struct because
the word reads as an ordinal in a codebase that runs real sequences called
blocks and phases. That was a naming decision forced by an existing collision,
and it will not be the last one.

## Collisions found so far

Turned up while drawing the wall boundary. **Not exhaustive** — this is a
starting list, not a survey.

| Word | Meanings in play |
|---|---|
| `stage` | `board__stage` the region; "the stage belongs to the question" the theatrical sense; a position in a sequence, which is why the struct is `Wall` |
| `mode` | solo vs teams (`setMode`, `state.mode`); the game module (`setGame`). Already flagged in `CLAUDE.md` |
| `held` / `hold` | `round.held` the boolean; "the hold" the beat before a rebound; "holds the wall" the verb |
| `read` | `server/reader.ts` the loop; `state.reading.running`; the `read` host action; `walk-read`; "the box reads" |
| `spoken` | `round.spoken` the transcript; `server/speech.ts` the TTS; the `Spoken` component; probe's `speak:` and `say:`; `say` the macOS binary |
| `answer` | `round.answer` the revealed correct one; the player's spoken one; the `/answer` endpoint; "the answer window" |
| `value` / `points` / `score` | `round.value` at stake; `award.points` awarded; `state.scores` accumulated |
| `open` | `useOpen`, past `armedAt`; `openRebound`; the judge "opens a window" |
| `lead` | `ARM_LEAD_MS` and `--lead`, a duration; "the lead changes hands", a position; `board__lead-in`, a region |
| `order` | `round.order` buzz order; `standings()` score order; `rank` in the CSS |
| duel roster | `candidates`, `seated`, `pool`, "finalists" — four words, overlapping referents |
| `round` | a round; a question; a flow block. Not always the same span |
| sound | `cue`, `recipe`, `bed`, `clip`, `sample` — some are genuine distinctions, some are not |
| `probe` | `tools/probe.ts`; "probe the interval" in `server/align.ts` |
| setlist | `server/flow.ts` "the game flow"; `state.flow`; "setlist" in the host UI |
| `leader` | `round.order[0]`; the wall's big name, now `hero` |
| `live` | the board chip, open only; "a live round", armed or collecting |

## Open questions for the brainstorm

- **What is the deliverable?** A glossary in `docs/design.md` that new code
  conforms to, actual renames, or both. A glossary is cheap and settles the
  next argument; renames cost churn and settle it permanently.
- **How far do renames reach?** `State` field names are the hard case:
  `state.json` is persisted beside the repo and `structuredClone` snapshots
  ride the undo stack, so renaming a field breaks a saved game unless the pass
  ships a migration or documents deleting the file. That constraint probably
  splits the work into a safe half and a breaking half.
- **CSS or not.** `board__stage` and its siblings are the largest single block
  of renaming and the lowest risk; they may be worth doing alone.
- **Which collisions are real?** Some of the rows above are genuine
  distinctions wearing similar clothes — `cue` and `clip` may both need to
  exist. The pass should shorten this table before it lengthens it.

## Sequencing

After the wall boundary lands. That work introduces `Moment`, `Wall`, `Phone`
and the `duel:` / `verdict:` / `buzz:` / `answer:` / `idle:` families, which
are themselves a canon proposal — better to see them in use than to canonise
around a guess.
