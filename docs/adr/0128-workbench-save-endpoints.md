# Workbench save endpoints are dev-only and refuse rather than guess

The motion harness and sound library write source files, so their endpoints are built to be impossible in production and to write nothing when a request does not match the source exactly.

- `animSave` and `sndLibrary` use `apply: 'serve'` and `configureServer`, so they exist only under `vite dev`; no built artefact can rewrite a source file or read a file off disk by name. The build's Rollup input is `client/index.html` only, so `anim.html` never ships (Vite would otherwise pick up every HTML file in the root).
- CSS values are replaced only between the `anim:tunables` markers and only on `--name:` lines already there; an unknown property is refused, not appended, so a stale dial cannot add dead CSS. `setConstant` rewrites a number in `toss.ts` only for a field on its own line directly inside the named `export const` block, and only with a plain number; anything else writes nothing.
- Everything that can refuse a save (unknown properties, missing cue markers, unwritable motion keys) is checked before any file is written, because half a save is worse than none.
- Cue recipes are regenerated wholesale between the `cue:recipes` markers rather than line-matched: a recipe is a tree with no per-line identity. Quoted JSON keys are valid TypeScript and the repo has no formatter to fight.
- A missing raw holding ground (`sounds/raw/` is ignored by git) is an empty library, not an error.
- Adopt refuses with 409 to overwrite an existing file unless `replace` is set, because `ffmpeg -y` overwrites and the panel's default name is a shipped file. ffmpeg runs with a 60 s timeout so a pathological input cannot hang the request with nothing in the panel.

Where: `vite.config.ts` (`animSave`, `sndLibrary`, `build.rollupOptions`), `tools/tunables.ts` (`setConstant`)
