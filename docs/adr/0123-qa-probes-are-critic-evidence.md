# QA probes report physical, device-relevant numbers as leads for critics

`tools/qa/` turns motion and sound into numbers for critic agents that cannot watch or listen. The numbers are chosen to compare with the real room, and a flag is a lead to look at, never a gate that fails a build.

- Kinematics runs the real path generators from `client/toss.ts` with fixed seeds and reports in card widths (cw) and seconds. A poker card is 6.3 cm wide, so 1 m/s is about 16 cw/s. Its physics flags (re-acceleration, jumps, spin growing in the air, restacking mid-air) can be legitimate, such as a hand pushing or a deliberate clamp.
- The sound report's `phone` figure is the share of energy above 400 Hz, roughly what a phone speaker can play. A cue below about 30% is mostly inaudible on a phone. `held` is the share of a cue's length within 10 dB of its peak: near 0 is a short hit, high is the steady "TV static" shape.

Usage lives in `README.md` (Development) and `.agents/skills/adversarial-qa/SKILL.md`, which also says to add a kinematics preset when a changed move has none.

Where: `tools/qa/kinematics.ts` (`violations`, `summary`, `PRESETS`), `tools/qa/sound.ts` (`character`)
