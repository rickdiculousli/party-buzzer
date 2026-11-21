# Demo sounds are synthesized, gitignored throwaways named `demo-`

`npm run demo-sounds` fills the sound library with stand-ins so the Library panel and `+ layer` picker have something to audition. Everything is synthesized by ffmpeg from `lavfi` sources (nothing downloaded or vendored), hard-coded as five raw files and two adopted ones rather than a parameterised generator, since the browser already has a synthesizer. Each has a distinct waveform silhouette, and the raw names are deliberately messy (Freesound prefixes, ` (1)` suffixes, names `safeOut` refuses) so adopting shows where names get cleaned up.

Adopted demos are named `demo-` and gitignored, so a recipe layer pointing at one plays locally and 404s elsewhere; `clean` sweeps every `demo-*` in `client/public/sounds/`, not just the two it made, because files adopted from the raw set during a session carry the prefix too.

Where: `tools/demo-sounds.ts` (`RAW_FILES`, `ADOPTED`, `clean`), `.gitignore`
