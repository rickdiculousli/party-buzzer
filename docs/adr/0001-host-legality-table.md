# Host-action legality is one shared table

`refuses` in `shared/legality.ts` is the single answer to "may the host do this now", read by both the server's `applyHostAction` and the host surfaces, so a live button the server ignores or a greyed one it would accept cannot drift apart silently.

- A refusal is a code (`Refusal`), never a sentence, as `shared/wall.ts` returns moments rather than colours. One code per reason, not per guard (`correct`/`wrong` share `no-leader`, setup actions share `not-idle`). Duel eligibility is deliberately absent: it hints at what closing would resolve and needs helpers this file may not import (see [0091](0091-legality-vs-surface-hints.md)).
- The host's words are `REFUSAL_TEXT`, a `Record<Refusal, string>`, so a new code does not typecheck until its sentence exists. Each sentence states the fact, then the consequence, and names what the host can press instead, because the host reads it one-handed with a room waiting.
- One `switch` over `action.a` with no `default`, so a new `HostAction` does not compile until it states when it is legal. `idle` is annotated `Refusal | null` so codes stay type-checked. The test's `LEGAL` record is keyed by every action kind and checks the table in both directions (a code that never returns null is a button nobody can press); its refusal cases list every `not-idle` action.
- `shared/` never imports `server/`, so every rule is expressible over `State` alone; catalog checks read `state.games`/`state.duelRules`, and the tests build their room locally rather than importing `newState`.
- Only the host and the server may ask: `correct`/`wrong` read `round.order[0]`, which `viewFor` redacts on phones.
- `arm` has no rule beyond an introduction: arming a LOCKED round is "clear the board and go again". The one real restriction, buzzers already open, is clock-derived (`useOpen` counting to `armedAt`) and stays the surface's.
- Verdicts need `LOCKED` with a leader: a provisional leader shows from 150 ms in, but scoring during `COLLECTING` would strand buzzes still in the air. `already-scored` uses `isPenalty`, never the sign, because a no-penalty wrong stamps zero points and a penalty leaves the question live.
- `openDuel` is idle-only because seating stamps `buzzable` at the arm. `closeDuel` checks seated before phase, because that is the reason the host can act on.
- `next`, `resetRound` and `cancelDuel` are never refused: they are how a host gets out of a stuck question or duel. Settings and roster actions are legal mid-question (fixing a name, correcting a score, kicking a phone), and the roster stays editable through a minigame.
- `undo` is always legal and served by the hub. `openLobby` needs a quiet quiz room; a repeated open is the hub's `unchanged`. `closeArrival` is scoped by arrival id, so a stale Continue does nothing.

Where: `shared/legality.ts` (`refuses`, `Refusal`), `shared/legality.test.ts` (`room`, `LEGAL`, `REFUSED`), `server/state.ts` (`applyHostAction`), `client/ui.ts` (`REFUSAL_TEXT`, `actionFeedback`)
