# Voice performance

How to write for the paid voice (ElevenLabs v4). This applies only when
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
  `# wrong` and `# nobody` lines. About one verdict in two gets a quip, never
  the same line twice running; the rest get a plain line from `# plain correct`,
  `# plain wrong` or `# plain nobody`, taken in rotation. A line marked `★` is
  sincere and plays a quarter as often. Each line renders as its own take, so
  editing a line re-renders only that line.

## What works in v4

Tested on 2026-10-08 with the Buzzer Host – Dynamic voice, which is the house
voice.

- **Tags:** short (`[sarcastic]`, `[deadpan]`, `[sighs]`) or a descriptive
  phrase with commas (`[low, dry, side of mouth]`, `[low, gravelly voice]`).
  A phrase and the same ideas as separate tags (`[low] [dry]`) sound the
  same. Put the tag right before or right after the words it shapes.
- **Mood does not carry:** a quip's tag does not bleed into the straight read
  that follows, so no reset tag is needed.
- **Changing mood:** a tag can switch mood mid-script with no bridge phrase:
  `He was known as the Red Priest. [excited] He taught there for thirty years!`
- **Pauses:** `[pause]` and `...` both work. v4 has no SSML, so `<break>` is
  not available.
- **Stress:** CAPS on one or two words. The first one lands hardest, and
  repeating it wears the effect down.
- **Stretch:** repeat a long vowel (`Veniiice`). For a short vowel, repeat the
  final consonant (`Reddd`). Or stretch a helper word next to the key word
  (`thirty looong years`).
- **Surprise:** `?!` or `??` at the end of a clause.
- **Build:** repeat the key word (`thirty years. Thirty!`), or interrupt with
  dashes (`thirty — THIRTY! — years`).
- **Also working:** `[sotto voce]`, `[beat]`, `[whispering]`, and stacked
  non-verbal tags (`[sharp inhale] [quick groan]`).
- **Laughing through words:** `[laughing while talking]`, `[through laughter]`,
  `[snickering]`, `[trying not to laugh] … [snickers]`, `[stifling a laugh]`,
  `[still laughing]` and `[giggling, barely holding it together]` all work. The
  laughter adds time, so give a laughing quip half the words of a straight one.
- **Laugh, then get out:** a laugh held through a whole line is tiresome. Laugh
  at the start, then exit mid-line into a straight read:
  `[trying not to laugh] That's... [clears throat] no.` or
  `[snickers] Okay. [deadpan, quick] Absolutely not.`
- **Accents come from wording:** dialect spelling (`Sit yo ass down`) gives a
  light accent on its own. An accent tag such as `[strong AAVE accent]` takes
  over the whole mood, which here came out excitable, so leave it out.
- **Keep a tag simple before a one-word closer:** `[clears throat, straight
  face] no.` said "no" twice; `[clears throat] no.` said it once.

A new mood tag on every clause still makes the read disjointed.

**Pace:** a quip has to land fast. A pool quip should run 2–3 seconds, and 3 is
already a little slow. A question's own `R:` line can run longer when the bit
earns it (Titanic's sung line runs about 7). Anything else at 6–8 seconds
drags. Put a speed word in the tag that fits the joke
(`[quick, dry aside]`, `[rapid, smug]`, `[fast, gossipy whisper]`). Keep
`slow` and `[long pause]` out of quips, and use a sound effect such as
`[clapping]` only on a short line. The Titanic `R:` line is the model: a short
sung bit, then a clipped deadpan.

## Not yet tried on v4

- **Sound effects:** `[applause]`, `[clapping]`, `[gunshot]`, `[explosion]`,
  `[swallows]`, `[gulps]`.
- **Experimental:** `[strong X accent]`, `[sings]`, `[woo]`, `[fart]`, which
  ElevenLabs says are less consistent across voices.
- **IPA:** a word written as IPA between slashes (`/ʃɪˈvɔːn/`) for a name the
  voice misreads.

v4 makes both delivery and sound effects, so a vague tag can come out as a
sound instead of a delivery. Describe the voice when a delivery is meant.

## Cost

Every new or edited line is billed once, then cached. The host's pack picker
and the chip beside Read show an estimate of what the next read will bill,
including any pool not yet rendered.
