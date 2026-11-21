# The board lays out the whole question from the first frame

The board receives the entire question at the arm (`round.whole`) and renders all of it, with the part the voice has not reached as hidden text that still takes its space. Every line break and word position is then fixed for the whole question, instead of the paragraph rewrapping and sliding words sideways on every clause. The unsaid part uses `visibility: hidden` rather than `opacity: 0` or a transparent colour, because those still expose the text to screen readers and Select All before the room is asked. `shown` is a prefix of `whole` by construction, so it is sliced by length rather than matched; without `whole` (a host reading by hand, an older snapshot) the board prints only what has been said.

Where: `client/Board.tsx` (`Question`, `Said`), `client/style.css` (`.board__unsaid`, `.board__question`)
