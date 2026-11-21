# Bow phone draw feedback

- The drawn bow rests at the last shot's direction and eases toward the live aim as tension builds; this is display only, and the aim sent to the server is the raw drag.
- The full-draw haptic pulses once on reaching full tension, re-arms only after tension falls below 95%, and never fires within 100 ms of the last pulse, so a finger hovering at the edge does not buzz repeatedly.

Where: `client/BowPlayer.tsx` (`BowPlayer`: `restAngle`, `fullDrawArmed`, `lastFullDrawPulse`)
