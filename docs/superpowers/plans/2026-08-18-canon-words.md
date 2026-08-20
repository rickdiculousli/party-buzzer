# Canon Words Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every overloaded word in the repo one canon meaning — a glossary in `docs/design.md` plus renames reaching State fields, act strings, probe verbs, npm scripts and visible labels.

**Architecture:** Pure rename pass. No behaviour changes; the existing test suite (which drives `Hub` directly and walks whole questions) is the safety net. Wire renames land protocol + server + client + probe in a single commit so the tree is never half-renamed. `state.json` and saved `flows/` files from before the pass are abandoned, not migrated — the README says to delete/rename them.

**Tech Stack:** Node 26 native TypeScript, preact, plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-canon-words-design.md`

## Global Constraints

- No behaviour change anywhere. If a test needs its expectations updated beyond names, the rename went too far.
- Wire renames (anything in `shared/protocol.ts`) land both sides in one commit.
- The harness Save middleware rewrites the `cue:recipes` block by its field names — a recipe field rename must cover the type, every recipe literal, and the harness UI that drags those fields, in the same commit.
- `enum`, `namespace` and constructor parameter properties are unavailable (Node strips types).
- No migration code for `state.json` or `flows/`; the docs note says to delete/rename.
- Tests: `npm test` and `npm run typecheck` must pass after every task. That is the whole test story for a rename pass — no new tests unless a rename accidentally changes behaviour, which is a bug, not a task.

---

### Task 1: The glossary

**Files:**
- Modify: `docs/design.md`

**Interfaces:**
- Produces: a "Canon words" section every later task conforms to and the final docs task links from CLAUDE.md.

- [ ] **Step 1: Write the glossary section**

Add a "Canon words" section to `docs/design.md` covering, one line each: round vs question vs block; value/points/score; order vs standings; leader vs hero; read (the box only); open (becoming available); cue/recipe/layer/bed/clip/sample; hold (the verdict beat only); sustain (envelope); delay (arm countdown) vs lead (buzz position); mode (the game module) vs grouping (solo/teams); setlist; pool/seated/buzzable; spoken (a player's transcript) vs answer (the revealed correct one); wall/stage (CSS regions) — `board__wall` renders the `Wall`, `--stage` is only the backdrop colour.

- [ ] **Step 2: Commit**

`docs: the canon words`

---

### Task 2: Envelope `hold` → `sustain`, "stages" → segments

**Files:**
- Modify: `client/cues.ts` (recipe layer type + every recipe literal in `cue:recipes`)
- Modify: `client/synth.ts` (`schedule` reads the envelope fields)
- Modify: `client/anim/Layers.tsx` (envelope drag handles)
- Test: `client/cues.test.ts`, `client/synth.test.ts`

**Interfaces:**
- Produces: recipe layer field `sustain` where `hold` was. Nothing outside the sound stack reads envelope fields.

- [ ] **Step 1: Rename**

Envelope field `hold` → `sustain` in the layer type, all recipe literals, `synth.ts` scheduling arithmetic, the Layers panel handles and labels, and both test files. If the envelope segment list is spelled "stages" anywhere in these files, it becomes "segments".

- [ ] **Step 2: Verify zero strays**

`grep -rn '\bhold\b' client/` — only `round.held`-adjacent prose and `--verdict-hold` may remain.

- [ ] **Step 3: Test, typecheck, commit**

`npm test && npm run typecheck`. Commit `sound: the envelope holds nothing — it sustains`.

---

### Task 3: `.board__stage` → `.board__wall`

**Files:**
- Modify: `client/Board.tsx` (the region div)
- Modify: `client/style.css`
- Modify: `client/anim/harness.css`, `client/anim/scenarios.tsx` if referenced

**Interfaces:**
- Produces: CSS class `board__wall`. `--stage` (colour token) and `.harness__stage` (dev harness pane) stay.

- [ ] **Step 1: Rename** the class in all four files. Do not touch `--stage` or `.harness__stage`.

- [ ] **Step 2: Verify**

`grep -rn 'board__stage' client/` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`board: the stage region is the wall it renders`.

---

### Task 4: `Probe` → `Transcriber` in the alignment code

**Files:**
- Modify: `server/align.ts` (the type and its parameter)
- Modify: `server/stt.ts` (passes the function in)
- Test: `server/align.test.ts`

**Interfaces:**
- Produces: type `Transcriber` where `Probe` was — a function taking `(fromMs, toMs)` and returning transcript lines. `tools/probe.ts` owns the word "probe" after this.

- [ ] **Step 1: Rename** the type, its parameter name, and test references. Comments saying "probe the interval" become "transcribe the interval".

- [ ] **Step 2: Verify**

`grep -rni 'probe' server/align.ts server/stt.ts server/align.test.ts` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`align: probe is the tool's name; this transcribes`.

---

### Task 5: `chip--live` → `chip--open`, text "Open"

**Files:**
- Modify: `client/Board.tsx` (chip class and label text)
- Modify: `client/style.css` (`.chip--live` rule)

**Interfaces:**
- Produces: `chip--open` alongside the existing `chip--armed/won/barred/data` family.

- [ ] **Step 1: Rename** class and change the chip text from "Live" to "Open".

- [ ] **Step 2: Verify**

`grep -rn 'live' client/Board.tsx client/style.css` → nothing but prose.

- [ ] **Step 3: Test, typecheck, commit**

`board: the chip says what it is — open`.

---

### Task 6: `mode` → `grouping` (solo/teams)

**Files:**
- Modify: `shared/protocol.ts` (`State.mode`, `Mode` type, `setMode` host action)
- Modify: `server/state.ts`, `server/hub.ts`, `server/duel.ts`
- Modify: `client/Host.tsx`, `client/GameSettings.tsx`, any other client reader of `state.mode`
- Modify: `tools/probe.ts` (`teams:` verb sends the renamed action), `tools/sim.ts`
- Test: `server/*.test.ts` referencing `mode`/`setMode`

**Interfaces:**
- Produces: `State.grouping: 'solo' | 'teams'`, type `Grouping`, host action `setGrouping`. Frees the identifier `setMode` for Task 7. Probe verb `teams:` keeps its spelling — it names a grouping value.

- [ ] **Step 1: Rename** everywhere in one pass: field, type, action, every reader, every test.

- [ ] **Step 2: Verify**

`grep -rn '\bsetMode\b\|state\.mode\b\|State\.mode\b' server client shared tools` → nothing. (Bare word `mode` still exists — the game module — until Task 7 gives it the action.)

- [ ] **Step 3: Test, typecheck, commit**

`state: solo-or-teams is a grouping, not a mode`.

---

### Task 7: `setGame` → `setMode`, probe `game:` → `mode:`

**Files:**
- Modify: `shared/protocol.ts` (`setGame` host action)
- Modify: `server/state.ts` (the handler), `server/flow.ts` if it sends it (it does — flow blocks apply `setGame` at boundaries)
- Modify: `tools/probe.ts` (`game:` verb → `mode:`)
- Modify: `package.json` (walk scripts using `game:`)
- Modify: `docs/manual-checklist.md` lines referencing `game:`

**Interfaces:**
- Consumes: Task 6's freed `setMode` name.
- Produces: host action `setMode` meaning "switch game module". `FlowBlock.game`, `game.moduleState`, `games[]` keep their names — "game" remains the word for a module instance; only the action verb changes. Probe `game:` becomes `mode:`.

- [ ] **Step 1: Rename** the action and the probe verb, update package.json script bodies and checklist references.

- [ ] **Step 2: Verify**

`grep -rn 'setGame' server client shared tools` → nothing. `grep -n 'game:' package.json docs/manual-checklist.md` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`state: switching games is setMode; the warning in CLAUDE.md retires`.

---

### Task 8: `flow` → `setlist` everywhere

**Files:**
- Rename: `server/flow.ts` → `server/setlist.ts`; `server/flows.ts` → `server/setlists.ts`
- Modify: `shared/protocol.ts` (`State.flow`, `State.flows`, `FlowBlock`, `FlowState`, `setFlow`/`flowJump`/`clearFlow`)
- Modify: `server/state.ts`, `server/hub.ts`, `server/reader.ts`, importers of both renamed files
- Modify: `client/Host.tsx`, `client/FlowPanel.tsx` → rename to `client/SetlistPanel.tsx` (component and any CSS classes carrying `flow`)
- Modify: `tools/probe.ts` (`flow:` → `setlist:`; `jump:` keeps its spelling)
- Modify: `package.json` (`walk-flow` → `walk-setlist`)
- Modify: `docs/manual-checklist.md` (walk-flow section)
- Test: `server/flow.test.ts` → `server/setlist.test.ts`, plus any other flow references in tests

**Interfaces:**
- Produces: `State.setlist`, `State.setlists`, `SetlistBlock`, `SetlistState`, actions `setSetlist`/`setlistJump`/`clearSetlist`, probe verb `setlist:`, npm script `walk-setlist`. On-disk saved-flows directory becomes `setlists/` (old `flows/` abandoned — README note lands in Task 12).

- [ ] **Step 1: Rename** files with `git mv`, then identifiers, verbs, script names.

- [ ] **Step 2: Verify**

`grep -rni '\bflow' server client shared tools package.json` → nothing (watch for false friends like "overflow" — those stay).

- [ ] **Step 3: Test, typecheck, commit**

`flow: the room's word wins — it is a setlist`.

---

### Task 9: `round.candidates` → `round.buzzable`

**Files:**
- Modify: `shared/protocol.ts` (`Round.candidates`)
- Modify: `server/hub.ts` (the buzz gate), `server/duel.ts` (narrowing on a wrong answer)
- Modify: `client/Player.tsx`
- Test: duel/duel-teams tests referencing `candidates`

**Interfaces:**
- Produces: `round.buzzable: string[] | null`. Duel roster canon after this: `pool` (nominees), `seated` (the pair), `buzzable` (the gate). Prose "finalists" in comments becomes "the seated".

- [ ] **Step 1: Rename** field and every reader; fix prose while touching those lines.

- [ ] **Step 2: Verify**

`grep -rn 'candidates' server client shared tools` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`duel: candidates was the buzz gate — buzzable`.

---

### Task 10: `ARM_LEAD_MS` → `ARM_DELAY_MS`, `lead` → `delay`, lead-in → countdown

**Files:**
- Modify: `shared/protocol.ts` (`ARM_LEAD_MS`)
- Modify: `server/hub.ts`, `client/useSocket.ts` (`useOpen` returns `{open, delay}`)
- Modify: `client/Board.tsx` (`--lead` inline style, `.board__lead-in`), `client/Player.tsx` (`.player__lead-in`)
- Modify: `client/style.css` (`--lead`, `.board__lead-in`, `.player__lead-in`)
- Modify: `client/anim/scenarios.tsx` (references the var/class)
- Test: anything importing `ARM_LEAD_MS`

**Interfaces:**
- Produces: constant `ARM_DELAY_MS`, `useOpen` result field `delay`, CSS var `--delay`, classes `board__countdown` / `player__countdown`. "Lead" survives only as the buzz-order position in prose.

- [ ] **Step 1: Rename** all of the above in one pass.

- [ ] **Step 2: Verify**

`grep -rn 'ARM_LEAD\|lead-in\|--lead\b' server client shared tools` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`timing: the arm waits a delay; the lead is a position`.

---

### Task 11: `POST /answer` → `POST /spoken`

**Files:**
- Modify: `server/index.ts` (the route)
- Modify: `server/judge.ts` (posts the verdict path)
- Modify: `tools/probe.ts` (`speak:` and `say:` POST paths)
- Modify: `docs/manual-checklist.md` (line referencing the endpoint)

**Interfaces:**
- Produces: `POST /spoken` accepting a transcript (`text/plain`) for judging. `round.answer` keeps its name — it is the revealed correct answer.

- [ ] **Step 1: Rename** the route and all three posters.

- [ ] **Step 2: Verify**

`grep -rn '/answer' server tools docs/` → nothing.

- [ ] **Step 3: Test, typecheck, commit**

`judge: the endpoint takes what was spoken, not the answer`.

---

### Task 12: Docs sweep

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/manual-checklist.md`
- Modify: `docs/superpowers/specs/2026-08-18-canon-words-design.md` (status → done)

**Interfaces:**
- Consumes: every earlier task's new names.

- [ ] **Step 1: CLAUDE.md** — delete the "Two different things are called mode" warning (the collision is gone); update `server/flow.ts` → `setlist.ts`, `walk-flow` → `walk-setlist`, probe verb names, `round.candidates` → `buzzable`, and add one line pointing at the glossary in `docs/design.md`.

- [ ] **Step 2: README.md** — add the upgrade note: across this change, delete `state.json` and rename any saved `flows/` directory to `setlists/`.

- [ ] **Step 3: manual-checklist.md** — sweep remaining stale names (`walk-flow`, `game:`, `/answer`, anything grep finds).

- [ ] **Step 4: Verify**

`grep -rni 'setGame\|\bflow\b\|walk-flow\|candidates\|ARM_LEAD\|board__stage\|chip--live\|/answer' CLAUDE.md README.md docs/` → nothing but the spec's historical collision table.

- [ ] **Step 5: Full gate and commit**

`npm test && npm run typecheck`, then a live smoke: `npm start` boots, `npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct` runs a round, `npm run probe -- clear`. Commit `docs: the canon, recorded`.

---

## Self-review notes

- Spec coverage: every canon-table row maps to a task — glossary-only rows → Task 1; cheap renames → Tasks 2–5; wire renames → Tasks 6–11; docs → Task 12.
- Ordering dependency: Task 7 requires Task 6 (needs the freed `setMode` name). All others are independent.
- Deliberately excluded: renaming `round.held`, `--stage`, `.harness__stage`, `probe` the tool, probe verbs `teams:`/`jump:`, the `game` word for module instances — all per the spec's canon table.
