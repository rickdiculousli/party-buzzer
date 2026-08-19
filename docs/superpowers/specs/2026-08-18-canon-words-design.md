# Canon words — a disambiguation pass

**Status: designed 2026-08-18, approved.** One pass over the repo's overloaded
words: a glossary in `docs/design.md`, renames everywhere including State
fields, probe verbs, npm scripts and visible labels. A saved `state.json`
from before the pass is not migrated — the docs say to delete it.

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

Settled by the brainstorm:

- **Deliverable: glossary plus everything.** A canon table in `docs/design.md`
  and renames of every colliding identifier — State fields, act strings, probe
  verbs, npm scripts, visible labels. No alias policy; the old word is gone.
- **`state.json` is not migrated.** The checklist/README note says to delete it
  when upgrading across this pass. Undo-stack snapshots are in-memory and die
  with the process, so nothing else persists.
- **CSS is in.** `board__stage` and its siblings rename with the rest.
- **Which collisions are real** — decided below; the table shrank.

## The canon

### Glossary-only (already consistent; the glossary pins them)

- **value / points / score** — `round.value` at stake, `award.points` awarded,
  `state.scores` accumulated. Three names, three things, kept.
- **order** — `round.order` is the buzz order, `standings()` the score order,
  `.rank` the CSS. Prose stops using "order" for standings.
- **round / question / block** — a *round* is one arm→verdict cycle; a
  *question* is the pack content; a *block* is a setlist segment. Identifiers
  already follow this; prose is brought in line.
- **sound words** — cue, recipe, layer, bed, clip are all real and disjoint.
  "sample" survives only as "a file-sourced layer".
- **read** — belongs to the box (`Reader`, `state.reading`, `act:read`).
  Reading a file is prose.
- **leader / hero** — already split (`order[0]` vs `Wall.hero`).
- **open** — `useOpen`, `openRebound`, `openDuel` are one sense: a thing
  becoming available. Kept.

### Cheap renames (code/CSS only)

- Envelope **`hold` → `sustain`** (it is the ADSR sustain stage), freeing
  "hold" for the verdict beat (`round.held`, `verdict:hold`, `--verdict-hold`
  stay). The envelope segment array "stages" → **segments**.
- **`.board__stage` → `.board__wall`** — the region renders the `Wall`.
  `--stage` (backdrop colour) and `.harness__stage` (dev-only) stay.
- **`Probe` in `server/align.ts` → `Transcriber`** — `tools/probe.ts` owns
  "probe".
- **`chip--live` → `chip--open`**, text "Live" → "Open" — it is gated on
  buzzers-open, i.e. `buzz:open`. "Live" retires.

### Wire renames (State fields, acts, probe verbs, npm scripts)

- **`mode` → `grouping`** for solo/teams (`State.mode`, `setMode`; probe
  `teams:` stays — it names a grouping value). **`setGame` → `setMode`** and
  probe `game:` → `mode:`, so "mode" means the game module, matching
  `server/modes/` and `GameModule`. Retires the CLAUDE.md warning.
- **`flow` → `setlist` everywhere**: `server/flow.ts` → `setlist.ts`,
  `server/flows.ts` → `setlists.ts`, `State.flow`/`flows`, `FlowBlock` →
  `SetlistBlock`, `setFlow`/`flowJump`/`clearFlow` →
  `setSetlist`/`setlistJump`/`clearSetlist`, probe `flow:` → `setlist:`,
  npm `walk-flow` → `walk-setlist`, `flows/` dir → `setlists/`.
- **`round.candidates` → `round.buzzable`** — the players allowed to buzz
  right now. Duel roster canon: `pool` (nominees), `seated` (the pair),
  `buzzable` (the gate); prose "finalists" → "the seated".
- **`ARM_LEAD_MS` → `ARM_DELAY_MS`**, `useOpen().lead` → `delay`,
  `--lead` → `--delay`, `.board__lead-in`/`.player__lead-in` →
  `…__countdown`. "Lead" belongs to the buzz-order position only.
- **`POST /answer` → `POST /spoken`** — it receives a transcript for judging;
  `round.answer` is the revealed correct answer.

## Sequencing

After the wall boundary lands — done (merged at 106982f). The pass itself runs
as one commit per canon group above, each independently green, wire renames
landing both sides (protocol + server + client + probe) in a single commit.
