# How `<Glitch>` drives its hit cycle

- Only the base layer's `animationiteration` and `animationend` drive the cycle; every layer fires its own, and the base's are the hit's.
- Each pass inside a hit gets a fresh cut, but keeps the hit's `--g-reps`; only a new hit draws a new repeat count, so a hit's length is fixed when it starts.
- A breather flash removes `is-flash`, forces a reflow, then re-adds it, so a flash restarts even straight after the previous one.

Where: `client/fx.tsx` (`Glitch`), `client/fx.ts` (`glitchCut`, `flashTimes`)
