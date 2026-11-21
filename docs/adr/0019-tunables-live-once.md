# Motion tunables live once in CSS; cue numbers live in recipes

Every signature motion number lives in the `anim:tunables` block of `client/style.css`, the one place the motion harness reaches and writes back, even when script paces on it (`--mark-stagger` spaces the marks and their sounds; `--type-chunk`, `--verdict-hold` and `--penalty-dwell` pace timers) and reads it with `tune()`. `TUNE` holds exactly one JavaScript fallback per tunable, held equal to the CSS by `client/tunables.test.ts`, and `parseTune` reads a trailing `s` because the production minifier rewrites `1000ms` as `1s`. A cue's gain, delay, envelope and trim are fields on its recipe in `client/cues.ts`, never custom properties, so no number has two homes.

Where: `client/style.css` (`anim:tunables`), `client/sound.ts` (`TUNE`, `tune`, `parseTune`), `client/cues.ts` (`RECIPES`), `client/tunables.test.ts`
