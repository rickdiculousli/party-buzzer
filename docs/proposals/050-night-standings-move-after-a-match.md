---
id: 050
title: The night's standings move when a match closes
kind: ux
size: S
judge: opus
status: done
lens: ux
proposed_by: c76bd40c-135e-429a-ba38-f09b146bce27
proposed_on: 2026-11-04
---

## Opportunity
A match pays the night at its results (`server/hub.ts:801`, before
`changed('minigame:results')` at `:806`). During the match `Board.tsx` returns
only the minigame's board (`client/Board.tsx:716-719`). When the match closes,
the quiz sidebar mounts already holding the paid scores, and `ScoreChange` is
still on first render (`client/fx.tsx:224-226`), so no score counts up and
nothing flashes. The rows likely do slide already: `useFlip(standingsList)`
(`Board.tsx:689`) keeps the pre-match positions while the list is unmounted
(`client/fx.tsx:189-210`). After a question the same sidebar counts and slides
every change (`Board.tsx:966-977`). Sketch's results are the only place its
per-match ranking shows (`client/SketchBoard.tsx:41`), so the fix can't go
inside a minigame board.

## Proposal
The board remembers what its standings last showed and counts from there.
A ref in `Board.tsx`, written on each quiz render the way `useFlip`'s `last`
map keeps row positions, holds the scores the room last saw. On the first
quiz render after a match closes, the standings show those scores for a beat,
then the real ones: `ScoreChange` counts up and flashes, and the existing
`useFlip` slide carries the rows (no second slide). This covers "Play again"
(`client/Host.tsx:94` sends `cancelMinigame`, which keeps the paid scores and
opens a new match, `runtime.ts:110-116`): three matches then Close count from
before the first. A player who joined mid-match counts up from 0; a kicked
player has no row. The hold mirrors the closest reveal (`useClosestHold`,
`client/ClosestLine.tsx:18`) and is off under `preview`, as that one is.
For the motion harness, the standings list becomes a component that takes the
scores to show, so a scenario in `client/anim/scenarios.tsx` can render the
switch.
In: the ref and hold in `Board.tsx`, the standings component, one harness
scenario. Out: every minigame board, the server, phones, the finale.

Judge: opus, because the hold reuses a pinned pattern and only its length is
a taste call, settled with the harness.

## What you'll see
Tug of war's results hold for their seconds. The board comes back with the
standings as the room last saw them; a beat later Nia's score counts up in
brass from 140 to 240 and her row slides from 4th to 2nd, beside "Next:
Trivia". Sketch's own results still list the match's points first.

## Verification
`npm test`, `npm run build`, `npm run test:review` in full at 1280×720 and
1024×600 (`tools/review/fits.spec.ts:23-27`); the layout doesn't change.
Film the harness scenario with `node tools/qa/filmstrip.ts <id>`, then run
`adversarial-qa`. Live: on a disposable room, `npm run sim-tug -- 3 15`; close
the first match from `/host` during the sim's four-second pause
(`tools/sim-tug.ts:115`), not the last (its cleanup kicks the bots), and see
the count and slide at both sizes; then play again twice and close, and see
the count start from before the first match.

## Shown
- The board comes back with the standings as the room last saw them, then a beat later the scores count up and the rows slide (live walk `node cache/walk-050.ts`, a scratch script standing in for `sim-tug`: a real server, the real `/board` at both sizes, four bots, a 6-second tug closed by the host 1.5 s into its results): `one 1280x720 +950ms: Ada:300 Bo:220 Cy:180 Nia:140` then `one 1280x720 +1700ms: Bo:320 Ada:300 Nia:240 Cy:180`; at 1024×600 the same pair, `one 1024x600 +950ms: Ada:300 Bo:220 Cy:180 Nia:140` and `one 1024x600 +1700ms: Bo:320 Ada:300 Nia:240 Cy:180`.
- Nia counts up from 140 to 240 and climbs from 4th to 2nd: the same walk, mid-count, `one 1280x720 +1150ms: Bo:281 Ada:300 Nia:201 Cy:180`.
- Sketch's own results still list the match's points first: `client/SketchBoard.tsx` is untouched (`git diff main --stat` lists only `client/Board.tsx`, `client/anim/scenarios.tsx` and this spec).
- `npm test`, `npm run build`: `ℹ pass 882` / `ℹ fail 0`, `✓ built in 852ms`.
- `npm run test:review` in full (fits at 1280×720 and 1024×600): `342 passed (1.4m)`.
- A harness scenario filmed: `node tools/qa/filmstrip.ts match-close` -> `.qa/match-close/timing.json  (4 animations, 480ms)`; the `match-close` scenario renders the held and the paid standings through the new `Standings` component.
- `adversarial-qa`: two rounds (timing and readability critics, then a fresh timing critic). Both round-1 critics found that rows a re-sort moves in the DOM replayed their entrance pop and clipped their score as the climbers passed; `Standings` now drops `fx-pop` from a row once it has played, and the round-2 critic confirmed it held live at both sizes.
- Easy to miss: after "Play again" several times, Close counts from before the first match, not the last: `before three: Bo:320 Ada:300 Nia:240 Cy:180` then, after three matches and Close, `three 1280x720 +950ms: Bo:320 Ada:300 Nia:240 Cy:180` and `three 1280x720 +1700ms: Bo:620 Nia:440 Ada:400 Cy:180`.
- Not shown: a player who joined mid-match counting up from 0, and the run with `npm run sim-tug -- 3 15` itself: the walk used its own bots so the host could close on a script; the mid-match joiner is by reading (`standings` scores a missing key as 0).

## Risks and the alternative considered
A board reloaded during a match holds nothing and stays quiet. If the match
was the setlist's last block, the finale slides the sidebar off
(`client/style.css:557-565`) and the podium carries the result. Alternative
considered: subtract the last match's results from the scores; rejected
because "Play again" pays several matches before Close.

## Needs from the operator
