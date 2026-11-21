# The welcome bed plays once a night and follows the latest request

The welcome bed plays only while the board is up with no minigame, no buzz and no question scored all night, and stops for good once the host arms the first question or opens a minigame. "The round is idle" is deliberately not the condition: it holds between every pair of questions, and the bed would swell back each time.

- `startBed` does nothing when the same bed is already playing, because the board calls it from a render path on every broadcast. The bed decodes itself when started.
- `wanted` records the latest request, so a bed whose decode finishes after the lobby has ended never starts.
- `stopBed` fades from the gain's current value, so stopping mid-fade-in never jumps loud.

Where: `client/Board.tsx` (`Board`: `welcoming`), `client/sound.ts` (`startBed`, `stopBed`, `wanted`)
