# Motion harness audio: what plays, and when it is decoded

The harness exists to tune a cue against its animation, so what it plays must be exactly what is being tuned.

- The draft recipe, not the committed table, is what the harness plays and draws. `play` receives the dialled recipe directly, and `setDialled(draft)` makes cues a component fires itself (Spoken's per-chunk taps) play the draft too. No stylesheet holds a copy of a cue's numbers.
- A scenario's `sound` fires on the same edge as the animation, so the two can be judged as one event. Cues a component fires itself go on `tune` instead, which shows their layers and dials without firing them on the trigger.
- By default the sample slows with the picture (`follow`), because alignment is what is being judged; turning it off plays the sound at real speed.
- Files are decoded before the first take (`prime`), and decoding follows the draft (`primeFile` per draft layer), because adopting a sound onto a layer changes its URL without changing the cue. Otherwise the first take after a scenario switch or an adopt is silent.
- The layer picker decodes every adopted file on open so rows show durations, the one measurement that helps choose; size shows only until the decode lands. A preview plays a candidate as the layer `+ layer` would add (same default envelope and gain), not the raw file.
- Raw downloads are auditioned through the current trim and decoded once per session. `stop` takes an absolute context time, so both ends are scheduled from one `currentTime`; `cut` is wall-clock output length, as in `play()`. A cancel flag covers a stop that lands while the first decode is in flight.
- Adopt forces the output extension from the preset (`.wav` PCM one-shot, `.ogg` Opus bed), because ffmpeg picks its encoder from the extension.
- `usePreview` plays one preview at a time: starting one stops the other, clicking the playing row stops it, and `done` is id-checked so a late end cannot clear its successor. `SoundList` rows select on click; adopting or adding is a separate named button, and the row reuses the board's `.row`.

Where: `client/anim/main.tsx` (`Harness`: `follow`, `audition`, `raw`, `outFor`, `adopt`), `client/anim/scenarios.tsx` (`Scenario.sound`, `Scenario.tune`), `client/anim/Layers.tsx` (`Layers`, `previewRow`), `client/anim/SoundList.tsx` (`usePreview`, `SoundList`)
