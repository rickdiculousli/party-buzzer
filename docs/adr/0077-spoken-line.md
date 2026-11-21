# The spoken line types out dim and shows its verdict only once it has landed

`Spoken` types the judge's transcript a chunk at a time in `--dim`, holds `--verdict-hold`, and only then eases to brass or tally and fires `onSettled`, so the award stamp lands on the same instant; a colour on the first chunk would give the answer away before the room has read it. The turn is the moment, so it transitions rather than snapping. `settleMs` is the one formula for that instant, used by the line and by a phone that cannot mount it, so a pace change reaches both. The typing effect is keyed on the transcript alone and reads `onSettled` through a ref, so re-renders never restart it.

On the board the line is set in the display face at `--t-xl` like everything around it on the stage: a fixed body-face size reads across a room as a footnote to the question it replaced.

Where: `client/Spoken.tsx` (`Spoken`, `settleMs`), `client/ui.ts` (`chunks`), `client/style.css` (`.board__spoken`)
