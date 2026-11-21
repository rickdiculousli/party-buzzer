# Architecture decision records

These records hold the decisions that would otherwise live in code comments, which this repo does not allow; `npm test` fails on a comment in the code. A decision earns a record only when all three hold: it is hard to reverse, a reader of the code would be surprised by it without context, and it came from a real trade-off; an external constraint the code cannot show (browser, phone hardware, macOS speech, the party network) also qualifies. A smaller why goes in the guide that owns its area: board, host, phone, minigame-surface, motion and sound reasons in [docs/design.md](../design.md), server and runtime invariants in [ARCHTECTURE.md](../../ARCHTECTURE.md). To add one, take the next free number and write `NNNN-slug.md` as a `# Title`, one short paragraph of context, decision and why, and a `Where:` line naming files and symbols, then list it below.

## Architecture and server core

- [0001 Host-action legality is one shared table of refusal codes](0001-host-legality-table.md): `refuses` answers "may the host do this now" for server and surfaces alike; hints stay in the surface
- [0002 Display moments come only from facts every role receives](0002-moments-from-public-facts.md): board and phones compute the same moment from differently redacted state; clocks arrive as `Local`
- [0003 Buzzers open at a scheduled server instant, on each surface's own clock](0003-scheduled-arm-delay.md): `armedAt` sits `ARM_DELAY_MS` ahead so every surface opens together
- [0004 A miss is marked by `award.penalty`, never by the sign of `points`](0004-award-penalty-flag.md): `isPenalty`, because `-0` does not survive JSON
- [0005 LAN TLS from the published local-ip.sh wildcard](0005-lan-tls-via-local-ip.md): a published wildcard certificate buys phones a secure context for the mic

## Reading and judging

- [0006 One buzz collection window, ordered by press time](0006-buzz-collection-window.md): press-stamp order over a one-second window; the 150 ms reveal is not a cut-off
- [0007 Autoplay presses the keys around the verdict, never the verdict](0007-autoplay-around-the-verdict.md): autoplay holds a miss, then the reader opens the rebound; the host still judges
- [0008 The reader's waits are scoped by abort signals, not flags](0008-reader-cancellation-scopes.md): every await takes an `AbortSignal`, so stale questions never wake up
- [0009 The reader speaks a whole question in one breath and reveals it at measured folds](0009-joined-read-and-fold-search.md): one clip per question, folds found by bisecting a transcription oracle, always late rather than early
- [0010 ElevenLabs takes: the voice is the opt-in, and each take is paid once](0010-elevenlabs-takes.md): takes render once, the voice is the opt-in, folds come from character times
- [0011 Speech is pre-rendered to cached files and stopped by killing the player](0011-speech-playback.md): `say` renders to cache up front; stop and pause are `SIGKILL`
- [0012 Transcription is an on-device Swift helper, built on demand](0012-stt-native-helper.md): `swiftc`-built helper, no npm dependency, loud about macOS permissions
- [0013 The alignment helper is one line-protocol session per clip](0013-stt-session-protocol.md): serial range queries per clip, flushed unbuffered, on the main runloop

## Duels, items and setlists

- [0014 A setlist advises the room; the Reader stays the only issuer of `arm`](0014-setlist-never-arms.md): entering a block applies setup and stops; night automation never arms

## Minigames

- [0015 The minigame runtime owns lifecycle; definitions are pure rules behind a fixed hook contract](0015-minigame-runtime-contract.md): the runtime owns clocks, queues and acks; definitions are pure hooks

## Board

- [0016 The board gets the whole question at the arm and hides what is unsaid](0016-question-laid-out-whole.md): `round.whole` laid out once, unsaid text `visibility: hidden`, never sent to phones

## Phone

- [0017 Every surface's audio starts inside a user gesture](0017-audio-starts-in-a-gesture.md): the join tap is mandatory; contexts are resumed and borrowed, never minted in an effect
- [0018 Answer audio is buffered from lock-in and sent as mono WAV](0018-answer-audio.md): the worklet rings from lock-in; WAV because browsers disagree on codecs

## Sound and motion

- [0019 Motion tunables live once in CSS; cue numbers live in recipes](0019-tunables-live-once.md): `anim:tunables` is the one home, `TUNE` the one fallback, recipes own cue numbers
- [0020 Anchor cues stay hand-tuned WAVs, wrapped in no-op file layers](0020-anchor-cues-wrap-tuned-wavs.md): anchor WAVs sit in no-op `{ file }` layers at full level and set the loudness tiers
- [0021 Cue rate is one resampling knob, at play time and when baked](0021-cue-rate-resamples.md): `rate` resamples pitch and time together; adoption bakes it the same way
