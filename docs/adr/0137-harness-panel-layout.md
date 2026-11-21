# Motion harness panels do not jump

- Each track's gesture hint line is rendered even when empty (a non-breaking space), so the tracks below do not jump as the pointer crosses the stack.
- The download trim and keep controls appear only once a download is chosen, with a one-line prompt until then, rather than sitting greyed out.

Where: `client/anim/Track.tsx` (`Track`, `.track__hint`), `client/anim/main.tsx` (`Harness`, the library section)
