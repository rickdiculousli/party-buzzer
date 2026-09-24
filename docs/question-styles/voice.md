# Voice performance

How to write for the paid voice (ElevenLabs v3). This applies only when
`ELEVENLABS_VOICE_ID` is set; `say` ignores all of it. Reference:
[packs/walk-b.txt](../../packs/walk-b.txt) and
[packs/quips/pools.txt](../../packs/quips/pools.txt).

## Direction

The question is read straight. The personality comes from an occasional side
quip, delivered with a different emotion and pace. Put quips on some questions,
not every one. The quips are crass, rough and sarcastic, and only rarely
sincere. If every question gets a performance, the room finds it annoying by
the third one.

## The three places a quip goes

- **`S:`, the performed read.** It replaces the fragments as what gets spoken.
  Keep the clue text plain, and put the quip after the last clue. At the end it
  needs no return to the straight voice, and the board is already complete.
  The script must say the fragments' words in order. Anything around them is
  skipped when the board is timed. Several `S:` lines form one script.
- **`R:`, on a right answer.** A quip about this particular answer. It plays
  every time the question is answered right, so write one only where it is
  worth hearing.
- **Verdict pools.** `packs/quips/pools.txt` holds generic `# correct`,
  `# wrong` and `# nobody` lines. About one verdict in three gets a quip, never
  two in a row, and never the same line twice running. A line marked `★` is
  sincere and plays a quarter as often. Each pool renders as one take, so
  editing one line re-renders its whole pool.

## What works in v3

Audio tags are short, one idea per tag, with no commas inside: `[sarcastic]`,
`[deadpan]`, `[mocking]`, `[sighs]`, `[strained groan]`, `[laughs]`. Put two
ideas in two tags: `[sharp inhale] [quick groan]`.

- **Stress:** CAPS or `*asterisks*` on one or two words. The first one lands
  hardest, and repeating it wears the effect down.
- **Stretch:** repeat a long vowel (`Veniiice`, `Priiiest`). For a short vowel,
  repeat the final consonant or add an h (`Reddd`, `Rehhd`). `Reeed` is read as
  "reed". Where the key word does not stretch well, stretch a helper word next
  to it instead (`thirty looong years`).
- **Surprise:** `?!` or `??` at the end of a clause.
- **Build:** repeat the key word (`thirty years. Thirty!`), or interrupt with
  dashes (`thirty — THIRTY! — years`).
- **Changing mood:** put the tag first, then a bridge phrase:
  `[excited] and get this — ...`. A tag inside the bridge dampens both moods,
  and a bridge with no tag comes out rushed.

## What does not work

`[then]`, `[sotto voce]`, `/` and `//` breath marks, and runs of interjections,
which leave long unnatural gaps. `[beat]` works but sounds staged. A new mood
tag on every clause makes the read disjointed.

## Cost

Every new or edited line is billed once, then cached. The host's pack picker
and the chip beside Read show an estimate of what the next read will bill,
including any pool not yet rendered.
