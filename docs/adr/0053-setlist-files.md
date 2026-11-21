# Saved setlists are whole JSON files named by a slug

Like packs, State holds only setlist filenames and the content lives on the box. A setlist is small, rare and host-authored, so it is one whole-file JSON write.

- The filename is a slug of the host's name with `.json` forced on, so a setlist saved as "night.txt" is still found by `listSetlists` on the next boot.
- A missing, malformed or other-build file reads as an empty (or sanitized) setlist rather than throwing; the host picked a name off a list and gets an answer.
- The setlists shipped in `setlists/` must play as they are: every block runnable by this build, and each pack big enough for the whole night, since a pack keeps its place across blocks and the counts naming it add up.

Where: `server/setlists.ts` (`readSetlist`, `writeSetlist`), `server/setlists.test.ts`
