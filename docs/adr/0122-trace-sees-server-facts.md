# The trace sees server facts only, not the board's animation clocks

`trace.jsonl` records Hub state changes. The board's `settled` and `retired` clocks are client-side animation dwells the trace cannot see, so `momentOfFrame` computes the moment as of before any dwell, and cue windows start at the frame time, which may be early by one settle dwell. Dwell-timing bugs belong to the motion harness (`npm run motion`), not to trace rules.

Where: `tools/trace.ts` (`momentOfFrame`), `tools/rules.ts` (`cueWindows`)
