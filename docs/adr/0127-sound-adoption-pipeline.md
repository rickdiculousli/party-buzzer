# Sound adoption bakes exactly what was auditioned, through validated names

- `tools/sndlib.ts` holds the pure decisions (which names are safe, the exact ffmpeg arguments, the credits row) and touches neither disk nor processes, so it is tested directly; the Vite plugin around it stays a thin shell.
- A raw name is refused outright unless it is already its own basename, not a dotfile, and audio. Reducing `nested/../../out.wav` to `out.wav` would still serve a file, just not the one named. The resolved-prefix check stays as a second defence. This holds even though the endpoints are dev-only: a name crossing HTTP is untrusted, and a traversal would read any file on the machine.
- Output names match `[a-z0-9-]+.(wav|ogg)` and nothing wider, because they become paths the server writes.
- The one-shot preset is trim, a 40 ms release fade, mono, 44.1 kHz PCM. `cutMs` is the length of output from `headMs`, the same meaning `play()` and the harness's audition use, so a clip dialled to 3.14 s is 3.14 s of sound wherever it starts. The input span is therefore `cut * rate`, and `atrim`'s end is an absolute input timestamp. `cut: 0` means the whole file and gets no fade, since its length is unknown and the function deliberately does not read the file.
- Rate is `asetrate` plus `aresample`, not `atempo`, because speed and pitch are one knob at runtime and the baked file must match what was heard while dialling.
- Adoption takes one input file. Layers already mix at play time; a baked mix would be an `OfflineAudioContext` render, not an ffmpeg graph.
- A recipe layer may point only at adopted files in `client/public/sounds/`, never at the raw holding ground, because anything a recipe names must be servable to the real board or the cue goes silent in production.

Where: `tools/sndlib.ts` (`safeRaw`, `safeOut`, `ffmpegArgs`, `creditsRow`), `vite.config.ts` (`sndLibrary`, `/__snd/adopted`)
