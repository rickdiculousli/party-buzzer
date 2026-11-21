# Matching transcribed words against the source text

`completed` counts how many leading source words a transcript accounts for. It undercounts rather than guesses, because an undercount only places a fold later, but it must not let one mishearing strand every later fold at the end of the clip.

- `norm` folds accents before stripping non-alphanumerics, because the transcriber adds accents the author did not type (`Dvorak` comes back `Dvořák`).
- Two words match as written or as numbers, and both readings are tried: "ten" comes back `10`, but "for" comes back "four", which normalising numbers first would lose. A shared-prefix inflection match ("returned"/"return") applies only from five letters, so "the" cannot swallow "there".
- A source word split into two tokens ("1812" as "18 12") or two source words heard as one token both count.
- A single substitution mid-transcript is forgiven when the next words line up; at the tail there is no such evidence and the last unmatched word stays uncredited, since it is likely a stub of a word still being spoken.
- Across a mangled phrase, `resync` looks up to `WINDOW` words ahead on both sides for `ANCHOR` (two) words agreeing in a row, choosing the nearest by total distance so a one-word hiccup beats a plausible match far away; everything skipped counts as spoken.
- Several words collapsing into one numeral ("two, too" as 22) is deliberately not decoded: real number parsing would be ambiguous, and resync already recovers whenever two later words survive.
- The torture fixture in `server/align.test.ts` is real `say`-to-transcriber output, not invented mishearings; regenerate rather than hand-edit it.

Where: `server/align.ts` (`norm`, `same`, `completed`, `resync`, `anchored`), `server/align.test.ts` (`TORTURE_HEARD`)
