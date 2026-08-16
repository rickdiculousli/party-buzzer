# Spoken answers — design

2026-08-16

The auto-host judges spoken answers. A locked-in player talks into their phone;
the server transcribes on-device with macOS Speech and fuzzy-matches against the
pack's answer variants; the verdict enters the hub as an ordinary host action so
undo, broadcast and rebound behave exactly as if the host had tapped C or W.

Decisions already made with the user:

- Fully automatic both ways: match → `correct`, mismatch or lapsed window →
  `wrong`. The host repairs mistakes with undo, after the fact.
- Auto-wrong applies `neg = round.value` — the same as the host's primary W.
- Push-to-talk on the phone: hold to speak, **release sends**, **drag down
  cancels** (cancel-and-hold-again is the re-record). Capture is already running
  from the lock moment, so the first syllable isn't clipped.
- Answer window is host-configurable: off (host judges a stall by hand) or a
  duration in seconds, after which silence scores wrong through the same path.
- The board shows the transcript and verdict as they land.
- Spoken answers exist only when the reader is driving a pack: the answer text
  lives in server memory and never enters `State`. Host-read games are
  untouched.

## Spike findings (throwaway, /tmp/stt-spike)

- `SFSpeechRecognizer` works from a bare unsigned Swift binary spawned via
  `child_process`, fully on-device, no network, no `.app` bundle, no signing.
- ~180ms wall per short clip once `speechd` is warm; the first run loads the
  model and is slower. Per-answer spawning is fast enough — no daemon.
- The helper's main runloop must spin (`RunLoop.main.run()`). Parking the main
  thread on a semaphore starves the XPC setup and the task never calls back.
  This was the only real failure mode found.
- Partial results stream in; ignored for now, final result only.
- TCC: ran without a prompt in the developer context. A fresh machine may get
  one "Terminal wants Speech Recognition" dialog on first use — a setup note,
  not a code path.

## Pieces

### 1. STT helper (`server/stt/stt.swift` → `server/stt/stt`)

~50 lines of Swift: read an audio file, feed it to
`SFSpeechAudioBufferRecognitionRequest` as one PCM buffer via `AVAudioFile`,
on-device, print the final transcript on stdout, errors on stderr, spin the main
runloop. Built by `swiftc` on demand at server boot when missing or older than
the source — same machine-binary posture as `say`/`afplay`/`ffmpeg`: never an
npm dependency. If `swiftc` or the framework is absent, the judge degrades to
off and the host judges by hand, exactly as today (mirrors `speech.ts`'s
"degrades to silence"). The first transcription pays the model load (spike:
~180ms warm, seconds cold), so the judge warms `speechd` at boot by transcribing
one throwaway `say` clip — the pipeline it replaces is already rendering clips
at pack select, one more shell-out at startup is free.

### 2. Pack alternates (`shared/pack.ts`)

`A: Vermont | VT | the Green Mountain State` — variants split on ` | `.
`Question.answer` stays the first variant (display text for `revealAnswer`);
`Question` gains `answers: string[]` (all variants). No `|` means one variant,
so existing packs parse unchanged.

### 3. The matcher (`server/match.ts`, pure)

`matchAnswer(transcript: string, answers: string[]): boolean`.

Normalize both sides: lowercase, strip punctuation, drop articles (a/an/the).
A variant is satisfied when every one of its content tokens has a transcript
token within a small edit distance — ≤1 for tokens up to 5 chars, ≤2 above.
Extra spoken words are ignored ("uh, the green mountain state?"). This absorbs
ordinary STT mangling ("vermant", "mountin") and still rejects a different
answer ("their mound" vs "Vermont"). One place to tune, one test file. ponytail:
token-set-plus-edit-distance is a heuristic, not semantics — genuinely
equivalent phrasings STT renders far apart ("twenty" heard as "twenty-eight")
will miss, and the host's undo is the documented repair path.

### 4. The judge (`server/judge.ts`)

Owns the window, the STT spawn and the verdict. Takes a `transcribe` seam (like
the reader's `speech` seam) so tests never touch Swift.

- The reader primes it at arm time: `judge.prime(answers)` — memory only, never
  `State`.
- When a round LOCKs with a leader while primed, the judge opens the window and
  publishes `round.judge` through the `act` channel, the same way the reader
  publishes `reading`. The shape is `{ until?: number }`: present means the
  judge is live and the phone should offer push-to-talk; `until` (a
  server-domain deadline) is present only when the window has a duration. When
  the window is off (`answerWindowSec: 0`) the judge publishes `{}` — the phone
  shows push-to-talk with no countdown, and only the host ends a stall. Swept
  with the next arm like other per-round fields, and dropped on `wrong` (the
  rebound's judge re-publishes it when the new leader locks).
- The leader's phone POSTs the WAV to `/answer` with its player id. The judge
  rejects anything that isn't the current leader inside the open window. As a
  probe/test hook, a `text/plain` body is the transcript itself, skipping STT.
- Transcribe → match → publish `round.spoken = { name, transcript, hit }` via
  the `act` channel, then send `correct` or `wrong { neg: round.value }` into
  the hub through a synthetic host connection (`{ id: 'judge', role: 'host' }`),
  identical to the reader's. Undo, validation, rebound and the reader's
  wait-for-award loop all apply unchanged.
- Window lapse with no POST → the same `wrong`. The timer reads
  `state.answerWindowSec`; 0 disables it.
- Race safety falls out of the existing guard: a host W that lands mid-
  transcription rebounds the round, and the judge's late `wrong` hits
  `phase !== 'LOCKED'` in `applyHostAction` and is dropped.
- `State.round` gains `spoken?: { name, transcript, hit }`, set with the
  verdict; board and host render it, players' views too (the room heard the
  answer aloud — nothing to redact). Cleared on the next arm like `award`.

### 5. Host setting (`answerWindowSec`)

One number, so it rides the existing machinery rather than a new settings
channel: `HostAction { a: 'setAnswerWindow'; sec: number }` beside `setValue`, a
field on `State`, a small input on the host screen. 0 = no timeout.

### 6. Phone (`client/Player.tsx`, `useSocket`)

- `getUserMedia` permission is requested once at join, inside the existing
  mandatory join tap (which is already the audio-unlock gesture). The mic stream
  itself opens only when the player locks in — permission at join, capture on
  demand.
- When `round.phase === 'LOCKED'`, the player's own order entry leads, and
  `round.judge` is set, the buzzer becomes the push-to-talk zone — with a
  countdown to `judge.until` (server-domain time, `now()`, clamped as always)
  when `until` is present, and no countdown when the window is open-ended.
- AudioWorklet captures mono PCM at the context's native rate; a WAV header
  carrying that rate is prepended on send (the spike's `say`-rendered clips
  were 44.1kHz and transcribed as-is, so no resampling step earns its place).
  ~6s recording cap auto-sends. WAV sidesteps the browser codec lottery
  (Safari: AAC; Chrome: Opus-in-WebM, which stock macOS cannot decode) and
  `SFSpeech` reads WAV directly. A few hundred KB per answer — nothing on LAN.
- Gestures: pointerdown starts, pointerup sends (`fetch POST /answer`), a
  downward drag past a threshold cancels and returns to the hold zone.
  `pointerdown`, never `click`, per the client rules.

### 7. HTTP route (`server/index.ts`)

`POST /answer`, `?player=<id>`. Sits beside the SPA routes; the WebSocket
contract is untouched — no new `ClientMsg`. Two body kinds: `audio/wav` (or
anything else) is a recording to transcribe; `text/plain` is the transcript
itself, which is how `probe`'s `speak:` step and the judge's own tests drive
the verdict path without audio. (Audio is a file upload, not a chat message;
HTTP is the right shape and keeps protocol.ts clean.)

## Error handling

- STT spawn fails / binary missing → judge degrades to off; host judges. The
  phone still shows push-to-talk while `round.judge` is set; if the server never
  set it (degraded), the phone never offers it — degradation is automatic.
- Garbage/empty transcript → a miss, scored wrong, host undoes if unjust.
- POST from a non-leader, late POST, or POST with no armed judge → 409, dropped.
- Wrong-window POST after a rebound → leader no longer matches → 409.

## Testing

- `server/match.test.ts`: variants, articles, case/punctuation, STT mangling
  accepted, different-answer rejected, empty transcript rejected.
- `server/judge.test.ts`: stubbed `transcribe`; window opens on LOCKED, verdict
  lands as `correct`/`wrong`, timeout path, late POST dropped, host-W race.
- `shared/pack.test.ts` (existing file if present): `|`-split variants and the
  single-answer back-compat case.
- `probe` gains a `speak:Name="transcript"` step that POSTs the transcript as
  `text/plain` straight into the judge's verdict path, so a whole spoken round
  is one command; real audio stays a `docs/manual-checklist.md` entry (the sim
  can't speak).

## What this deliberately does not build

- No partial-result streaming to the room (the spikes shows it's available;
  final-only is the lazy version).
- No persistent STT daemon — per-answer spawn measured ~180ms warm.
- No pronunciation/homophone smarts beyond the matcher heuristic.
- No spoken answers in host-read games (no answer text to match against).
