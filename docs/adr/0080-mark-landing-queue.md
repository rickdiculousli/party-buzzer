# Timeline marks queue for landing slots

The Hub publishes the first 150 ms of buzzes in one packet and later buzzes one per packet, so two presses 30 ms apart late in the window would land 30 ms apart, which reads as a blur. The board instead gives each new mark the later of now and the next free slot (`markGap` apart) as its `--enter` delay. The rail still plots every buzz at its true millisecond; only the telling is delayed.

- Delays are assigned during render, only for player ids not yet scheduled, so a re-render of the same state never reshuffles a scheduled landing. A new `attemptId` clears the assignments but not `nextSlot`; a slot already claimed stays claimed.
- The stamp sounds are spaced on the audio clock (`playSpaced`) with the same gap, not by each mark's delay, because the effect runs an unknown time after the render that placed the marks.

Where: `client/Board.tsx` (`Board`: `enter`, `nextSlot`, the buzz sound effect; `Timeline`), `client/sound.ts` (`markGap`, `playSpaced`)
