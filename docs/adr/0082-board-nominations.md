# Nominations show the seating the close will produce

- The nomination pool is a ranked list at room scale with the standings' row vocabulary, because it is the screen the room watches while deciding; one dim line of names is unreadable from across a room.
- The names lit as leading (the brass rail) come from `willSeat`, the same prediction the host desk runs, not the top two: in a teams grouping a same-team runner-up is skipped, and lighting them would promise a face-off the close will not produce. Under a volunteer rule the draw has no leader, so nothing is lit.
- In teams, each side nominates in its own equal column whatever each holds, because the seat takes the top of each column (a merged list would make the close look like it reaches past the runner-up) and neither side should look more considered for having nominated more. An empty column stays up so the room sees which side has not decided.
- "Who plays?" is pinned to the top of the lane and the lists hang below it out of flow, so the heading never moves however many names there are.
- A charging name slides instead of slamming because `.fx-slide` comes later in `style.css` than `.board__hero` and wins at equal specificity; moving either rule breaks it.

Where: `client/Board.tsx` (`NomList`, the `w.nominations === 'teams'` branch), `client/ui.ts` (`willSeat`), `client/style.css` (`.board__noms`, `.board__pool`, `.board__sides`, `.nom.is-lead`, `.board__charger`)
