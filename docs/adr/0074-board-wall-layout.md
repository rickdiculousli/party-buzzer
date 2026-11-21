# The board wall is three bands around a fixed centre lane

The wall is a three-row grid, `minmax(0, 1fr) auto minmax(0, 1fr)`: the two outer rows are equal by construction, so whatever sits in the middle is pinned to the exact centre whatever mounts above or below it (the award, a timeline growing a lane, lockout chips). The middle band is one fixed lane a hero line tall (`--t-hero` times its 0.86 line-height) whatever holds it, because a band sized to its occupant moves the band under it every time the stage changed hands; taller occupants grow upward out of the lane (`flex-end`), shorter ones centre on auto margins.

- The board's grid row is `100%`, the screen's height, never its content's: a taller wall would carry its foot, and the reaction pills on it, off screen.
- The band above aligns to its bottom edge and the band below to its top, so each grows away from the middle.
- `.board__wall .board__mid > *` is two classes deep so the auto margins outrank each occupant's own `margin: 0`; the nomination heading uses the same depth to pin itself to the lane's top.
- A choice question's lane drops the hero height (`height: auto`): it never has a hero name, and on a short screen that height pushed the grid off the bottom.
- The countdown uses `z-index: -1` to sit under every wall child; it stays above the wall itself only because `.board__wall` isolates.
- `Standings` takes its `list` ref from the caller, which runs `useFlip` on it, so the flip outlives the list while a match has the board and the re-sort still slides when it returns.
- The "Last question" card's `fx-tada` is delayed by `--fx-rise-dur`, so it starts after the card's rise and the two transforms do not fight.

Where: `client/style.css` (`.board`, `.board__wall`, `.board__mid`, `.board__above`, `.board__below`, `.board__wall.is-choice`, `.board__countdown`), `client/Board.tsx` (`Standings`, `Board`)
