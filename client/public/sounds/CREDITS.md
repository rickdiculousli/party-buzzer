# Sound credits

Renaming these by role dropped the Freesound IDs that were in the original
filenames, and those IDs are the only trail back to each sound's licence.
Keep this file in step with the directory.

Every file here is played. Each one is the source sound with its dialled-in
tuning already baked in, which is why the `--*-snd-*` values in style.css sit
at neutral: the pass below is what those knobs used to be doing live. Re-cut
from the Freesound original if a value ever needs to move again — the passes
are written out in full for exactly that reason.

The three one-shots stay uncompressed PCM on purpose. Opus would take them from
458KB to 56KB, but every Opus stream carries a 6.5ms pre-skip, and these are
sounds tuned against an animation frame by frame. That is a trade of alignment
for bytes on a LAN that has no shortage of bytes. The bed is the opposite case:
93 seconds of continuous music, no attack to protect, and by far the largest
thing shipped.

| File | Role | Source and pass |
| --- | --- | --- |
| `stamp.wav` | A mark landing on the timeline | Freesound [820352](https://freesound.org/s/820352/) by bryansaraiva — `typewriter-key-press-05.wav`, 0.22s, used as downloaded |
| `leader.wav` | The leader's name appearing | Freesound [428073](https://freesound.org/s/428073/) by newagesoup — `sub-drop-smooth.wav`, 3.76s → 0.84s via `-filter:a "atempo=1.5,asetrate=132300,aresample=44100"`: shorter at pitch, then a third of the length an octave and a half up |
| `leader2.wav` | The buzzer layered under it | Freesound [395806](https://freesound.org/s/395806/) by magedu — `buzzer_boardgame_02.wav`, 5.51s → 3.04s via `-af "atrim=0.1:3.14,asetpts=N/SR/TB,afade=t=out:st=3.0:d=0.04" -ac 1 -ar 44100`: 100ms of head trimmed off the front, cut at 3s with the same 40ms release `play()` would have applied |
| `welcome.ogg` | The welcome screen's looping bed | `Marimba Prize Run (0.75x).wav` — origin unrecorded; 17MB of PCM → 806KB via `-c:a libopus -b:a 64k -ac 1`. Opus rather than WAV because it is 93 seconds of music that nothing else on the board needs; Opus rather than MP3 because it loops without encoder padding; mono at 64k because it plays at 0.35 gain under a static screen. Wants Safari 17+, and a browser that cannot decode it gets silence on the welcome screen and nothing else |

Check each sound's licence on Freesound before this goes anywhere public;
several are CC-BY and want the attribution above carried with them.
