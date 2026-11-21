# Poker phone gestures and the peek are tuned on a real phone

`GESTURE` and `PEEK` are calibration knobs, set on real phones, not derived values. A still touch shorter than `pressMs` is a tap and longer is a press; flick speed is measured over the last `releaseMs` of the trace. A peek starts below a line `line` card widths above the pair's lowest point, bends both cards' bottom edge together, and is levered (`lever` times the finger's rise, at most `reach`) so a short drag shows a lot. The pull always leans `tilt` degrees up and to the left, so the right corners, where the indices are, open first; the finger may ease it back at most `flex` degrees.

Where: `client/poker.ts` (`GESTURE`, `PEEK`, `peekTip`, `classifyGesture`), `docs/manual-checklist.md`
