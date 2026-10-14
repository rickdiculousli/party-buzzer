---
id: 020
title: Music round: a pack question can be a clip the server plays
kind: feature
size: M
judge: opus
status: proposed
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
Name-that-tune is the oldest party round and the one everyone can play. The Reader already owns server-side playback of files with cancellation and resume (`Speech.play(path, fromMs): Playback` in `server/speech.ts`; "Buzzing interrupts speech", `ARCHTECTURE.md`), packs already carry an asset path (`I: images/tower.jpg`), and a buzz already stops the clip mid-word. Nothing lets a question be a sound. PRODUCT.md: "Question packs can be read aloud by the host or played through speech generated on the server machine"; a clip is the same path with a different file.

## Proposal
An `M: audio/intro-07.mp3` line in `shared/pack.ts` (a path under `packs/`, like `I:`). A question with `M:` plays the clip in place of reading its fragments after a short spoken lead-in if the fragments exist ("Name the song."); the Reader treats the clip as the joined utterance, so a buzz stops it, a rebound resumes at the stop point when the player supports seeking, and autoplay's buzz window begins at the clip's end. `round.clip = { durationMs }` is public so the board can show a needle across the clip and the phones can show Listen. An optional `M:` start offset (`M: audio/x.mp3 @ 42s`) picks the hook. `packs/audio/` is gitignored like `packs/phantom-ink.txt`: the files are the host's own. In: pack line and style page, Reader branch, Round field, board needle, phone Listen state, `walk-music` probe with two CC0 clips under `packs/audio/` committed as fixtures. Out: browser-side playback (the question voice is the server's by design), waveform art, any streaming or lookup service.

Judge: opus, because the Reader's branch and identity rules are pinned by the existing speech path and the only hard part is the resume offset.

## What you'll see
The board shows a needle sweeping a bar; the room hears eight seconds of a bass line through the TV; Bo buzzes, the music cuts, he says "Seven Nation Army", +200.

## Verification
`npm test`: pack parsing (missing file at prepare time is a diagnostic, not a crash), Reader tests on the mock clock for stop-on-buzz, resume offset and the autoplay window after the clip, `viewFor` exposing `clip` to every role. `npm run build`; `walk-music` against a disposable room on the Mac, where `afplay` lives.

## Risks and the alternative considered
Playback needs the Mac's players; on a machine without them the question degrades to silent text, as speech does, and the host reads the title from the answer. Licensing is the host's: the directory is ignored and the README says so. Alternative: a Sketch-style minigame for music; rejected because a clip is a question with an answer, and the quiz already judges those.

## Needs from Rick
