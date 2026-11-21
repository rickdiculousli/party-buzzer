# The choice grid never grows or crops the band

A choice question's options must fit the band below the question on any board screen.

- Option text clamps to two lines, so a long option cannot push the band.
- Cell type is bounded by viewport height as well as width (`min(..., 4.5vh)`), so a short screen shrinks the grid rather than cropping it.
- Each option's `li` is its stacking context and the cell has `z-index: 1`, so the pick dots behind the cell stay behind it even while the reveal animates the `li`.

Where: `client/style.css` (`.board__grid`, `.board__choice`, `.choice__option`)
