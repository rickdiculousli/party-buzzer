# Tug of war: the drawn flag, not the server frame, calls the moment

The board draws the rope as a physical object chasing the server's flag, and the room's verdict and cues follow what is drawn.

- The drawn flag is a mass on a damped spring toward the server flag (heavy: settling in about half a second with a slight carry), integrated in fixed 4 ms substeps so it behaves the same at any frame rate; a long gap such as a hidden tab snaps to the target.
- The flag's lean is a lightly damped pendulum chasing the rope's velocity, so a stopping knot swings past vertical.
- A stalemate shake uses hysteresis (on above `TENSE_ON`, off below `TENSE_OFF` or once the flag moves) so it never flickers and never drowns a real heave. Effort meters ease over `METER_MS` so they read as strain rather than strobe.
- A swing cue arms once the flag is past `CROSS_MARGIN` on one side and fires on the frame it crosses the centre, so sound and crossing are one event; at most one per `CROSS_GAP_MS`, extra swings pass silently.
- Only a win at the mark carries the rope past it; a win on time stays where the rope stopped. A mark win is shown only once the drawn flag arrives, not a frame ahead.
- Cues fire on transitions only, so a board reloaded mid-match, or mounting on a decided match, stays quiet.
- Sides and winner are remembered past the last frame so the results can name the winning side, even when nobody scored points.

Where: `client/tug.ts` (`follow`, `lean`, `tense`, `watchCrossing`), `client/TugBoard.tsx` (`useDrawn`, `useOnChange`, `TugBoard`)
