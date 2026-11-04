---
id: 050
title: The night's standings move when a match closes
kind: ux
size: S
judge: opus
status: proposed
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

## Risks and the alternative considered
A board reloaded during a match holds nothing and stays quiet. If the match
was the setlist's last block, the finale slides the sidebar off
(`client/style.css:557-565`) and the podium carries the result. Alternative
considered: subtract the last match's results from the scores; rejected
because "Play again" pays several matches before Close.

## Needs from the operator
