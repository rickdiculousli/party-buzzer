---
id: 040
title: The board and phones show who is actually in the room
kind: ux
size: S
judge: sonnet
status: done
lens: ux
proposed_by: f3e13ca3-5996-4d39-839c-6ee6289499ff
proposed_on: 2026-10-14
---

## Opportunity
The board's players chip counts connected phones; its standings list every
player ever joined, with no difference between the two.

![2 players, 10 rows](assets/040-board.png)
![the lobby counts 0 of 2 but shows 10](assets/040-board-lobby.png)
![the host knows: lamps on the Players tab](assets/040-host.png)

Measured at 1920×1080: "2 PLAYERS" beside ten identical standings rows; in
the lobby the host desk says "0 of 2 tested" while the wall shows ten "Not
yet" tiles, eight of them for phones that are not there. Only the host's
Players tab draws a lamp per player. A party host who sees ten names on the
TV and two lit on the laptop has to work out which is wrong. Both views are
built from `state.players`, which carries `connected` for every role.

## Proposal
One rule in CSS and two components: a disconnected player's row is dimmed
(`--dim` text, 0.5 opacity on the identity bar) with a small "away" chip at
`--t-chip-board` × 0.8 on the board standings, the lobby roster and the
phone dial; the lobby roster sorts connected first. The players chip
reads "2 OF 10 PLAYERS" when the two numbers differ. No ordering change in
the standings: away players keep their rank.
In: the chip text, the dim rule, the away chip, the lobby sort. Out:
removing players, reconnection logic, the host tab.

Judge: sonnet, because the states are already in the view and the rule is
one class.

## What you'll see
Ten rows, two bright, eight dim with "away"; the chip says "2 OF 10
PLAYERS"; the lobby wall shows the two phones that are here first.

## Verification
`npm run build`, `npm test` (a `viewFor` case that `connected` reaches
phones and the board stays as it is). Join three probe players, let the
probe exit, and confirm all three surfaces dim them within a second.

## Shown
- Chip reads "2 OF 10 PLAYERS": disposable server, 5 ws players, 3 closed, board at 1920x1080 -> `2 OF 5 PLAYERS`, 3 `.chip--away` in standings (screenshot read: Ada/Bo bright, Cy/Dee/Eve dim with "AWAY").
- Away players keep their rank: same run, Cy 3rd, Dee/Eve unranked below -> order unchanged; `standings flag a disconnected player away and keep their rank` in `client/ui.test.ts`.
- Lobby shows the present phones first: openLobby with 1 of 5 connected -> roster `[ 'BO', 'ADA', 'CY', 'DEE', 'EVE' ]`, Bo the only connected.
- `viewFor` case: `connected reaches phones and the board: a dropped phone is away for everyone` in `server/hub.test.ts`.
- `npm run build` -> `built in 858ms`; `npm run test:review` -> `294 passed`.
- Easy to miss: the 2s grace so a blink does not flicker: `.chip--away` animation delay and `.is-away` transition delay (2s) in `client/style.css`; coming back is immediate.
- Not shown: the phone dial live: it shares `standings()` and the same `.is-away` rule, but I did not screenshot it.
- Not shown: "dim within a second": the hub has no disconnect grace, so I used the spec's own 2s CSS delay; the dim lands about 2.3s after the drop.

## Risks and the alternative considered
A phone that drops for a second during a question would flicker; apply the
dim only after the hub's existing disconnect grace, if any, or a 2s CSS
transition delay. Alternative: hide away players entirely; rejected because
their score is still in the race.

## Needs from Rick
