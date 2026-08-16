# Spoken Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the reader drives a pack, a locked-in player answers by talking into their phone; the server transcribes on-device with macOS Speech, fuzzy-matches against the pack's answer variants, and enters the verdict as an ordinary host action.

**Architecture:** A new `server/judge.ts` watches the hub's state stream, opens an answer window when a round locks with a leader while primed, and returns its verdict through a synthetic host connection (`{ id: 'judge', role: 'host' }`) — undo, validation, rebound and the reader's wait-for-award loop all apply unchanged. Speech-to-text is a ~45-line Swift helper spawned per answer (spike-proven: ~180ms warm, on-device, no bundle). The phone records buffered PCM in an AudioWorklet and POSTs a WAV to a new `POST /answer` route; a `text/plain` body is the transcript itself, which is how probe and the tests drive the verdict path without audio.

**Tech Stack:** Node 26 native TypeScript (types stripped, no server build step, `.ts` extensions on relative imports), Swift (`swiftc` machine binary, never an npm dependency), Preact client, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-16-spoken-answers-design.md` — read it first; it carries the locked decisions and the spike findings.

## Global Constraints

- **Node 26.7.0, pinned via mise.** Server code is native TypeScript — relative imports carry `.ts`/`.tsx` extensions. `enum`, `namespace` and constructor parameter properties are unavailable.
- **Runtime dependencies are exactly `ws` and `qrcode`.** Client is `preact`. This feature adds none. `swiftc` is a machine binary invoked through `child_process`, like `say`/`afplay`/`ffmpeg`.
- **No CDN, no remote assets, anywhere.** The STT helper runs on-device; party WiFi has no internet route.
- Tests use `node:test` and `node:assert/strict` only.
- `npm test` is `node --test 'server/*.test.ts' 'server/modes/*.test.ts' 'client/*.test.ts' 'shared/*.test.ts' 'tools/*.test.ts'`. A bare directory does not work on Node 26 — new test files must match those globs.
- **`npm start` serves `dist/`.** A client change is invisible until `npm run build`.
- Deliberate simplifications that cut a real corner carry a `ponytail:` comment naming the ceiling and the upgrade path.
- `shared/protocol.ts` is the contract. State flows one way: clients send `ClientMsg`, the server mutates, the whole `State` is broadcast. There is no client-side game logic.
- Question content never enters `State` — the judge's primed answers live in server memory only.
- Preact hooks must be called before any early return; `pointerdown`, never `click`.

## Sequencing with the game-flow plan

`docs/superpowers/plans/2026-08-16-game-flow.md` is written but not yet executed, and it touches many of the same files. The overlap is additive everywhere except one branch — no shared identifiers (theirs: `setFlow`/`flowJump`/`clearFlow`, acts `saveFlow`/`loadFlow`, `state.flow`/`flows`; ours: `setAnswerWindow`, acts `judgeWindow`/`spoken`, `state.answerWindowSec`, `round.judge`/`spoken`).

- This plan's code blocks are written against main @ `dddac75`. If the flow plan lands first, every anchor below still exists; the only textual clash is the `next`/`resetRound` branch in `server/state.ts`, which flow Task 3 rewrites. Whichever lands second applies its own lines (`delete round.judge; delete round.spoken` for us) to whichever body is present.
- Both plans add lines to `newState()` and `loadState()` in `server/state.ts`, options to `startServer` in `server/index.ts`, one line to `withServer` in `server/e2e.ts`, act branches in `server/hub.ts` (theirs after `stopRead`, ours after `revealAnswer`), verbs and header lines in `tools/probe.ts`, and sections in `CLAUDE.md` / `docs/manual-checklist.md`. Different hunks; expect clean merges or trivial rebases.
- `client/Host.tsx`: theirs inserts a play strip above `host__controls` and a `FlowPanel` in the fold; ours adds an input inside `host__reader` and a spoken line after `host__minor`. Disjoint.
- `client/Board.tsx`: theirs adds a chip in `board__status`; ours adds a line in `board__above`. Disjoint.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/pack.ts` (modify) | `Question.answers: string[]`, split from the `A:` line on ` \| ` |
| `shared/pack.test.ts` (modify) | Variant split + back-compat tests |
| `server/match.ts` (create) | Pure fuzzy matcher: `matchAnswer(transcript, answers)` |
| `server/match.test.ts` (create) | Matcher tests |
| `server/stt/stt.swift` (create) | On-device file → transcript helper (cleaned spike) |
| `server/stt.ts` (create) | Build-on-boot + spawn wrapper: `sttBinary`, `transcribe` |
| `server/stt.test.ts` (create) | Wrapper tests against a fake shell binary |
| `server/speech.ts` (modify) | Export the existing `run` helper |
| `shared/protocol.ts` (modify) | `round.judge`, `round.spoken`, `state.answerWindowSec`, `setAnswerWindow` |
| `server/state.ts` (modify) | The action branch, the field defaults, the per-round sweeps |
| `server/state.test.ts` (modify) | State-machine tests for the above |
| `server/judge.ts` (create) | The judge: window, STT spawn, verdict via synthetic host conn |
| `server/judge.test.ts` (create) | Judge tests, in-process hub, stubbed `transcribe` |
| `server/hub.ts` (modify) | The `judgeWindow` / `spoken` act branches |
| `server/reader.ts` (modify) | `ReaderOpts.judge`; prime at arm, unprime at stop |
| `server/index.ts` (modify) | `POST /answer`, judge wiring, STT build + warm-up at boot |
| `server/e2e.ts` (modify) | `withServer` passes `transcribe: null` so tests never invoke `swiftc` |
| `client/wav.ts` (create) | Pure PCM → WAV encoder |
| `client/wav.test.ts` (create) | Encoder tests |
| `client/recorder.ts` (create) | Buffered AudioWorklet capture (the push-to-talk mic) |
| `client/Player.tsx` (modify) | Mic permission at join, push-to-talk zone with gestures |
| `client/Host.tsx` (modify) | Answer-window input, spoken transcript line |
| `client/Board.tsx` (modify) | The spoken line on the stage |
| `client/style.css` (modify) | `.board__spoken`, `.host__spoken`, `.buzzer--talk` |
| `tools/probe.ts` (modify) | The `speak:Name=transcript` verb |
| `docs/design.md`, `docs/manual-checklist.md`, `CLAUDE.md` (modify) | Docs |

---

### Task 1: Pack alternates

**Files:**
- Modify: `shared/pack.ts`
- Test: `shared/pack.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Question = { value?: number; fragments: string[]; answer: string; answers: string[] }`. `answer` is the first variant (display text); `answers` is every variant. The reader (Task 5) primes the judge with `q.answers`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/pack.test.ts`:

```ts
test('an A: line split on " | " carries every variant, first one is the display answer', () => {
  const { questions, errors } = parsePack(`Question one.
A: Vermont | VT | the Green Mountain State
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].answer, 'Vermont')
  assert.deepEqual(questions[0].answers, ['Vermont', 'VT', 'the Green Mountain State'])
})

test('a plain A: line is one variant — existing packs parse unchanged', () => {
  const { questions, errors } = parsePack(`Question one.
A: gold
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].answer, 'gold')
  assert.deepEqual(questions[0].answers, ['gold'])
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern="variant" shared/pack.test.ts`
Expected: FAIL — `answers` is `undefined`.

- [ ] **Step 3: Implement**

In `shared/pack.ts`, change the type:

```ts
export type Question = { value?: number; fragments: string[]; answer: string; answers: string[] }
```

Add a `variants: string[]` local beside `answer`, reset it in `flush`, push it into the question:

```ts
      questions.push({ value, fragments, answer, answers: variants })
```

In the `A:` branch:

```ts
    if (line.startsWith('A:')) {
      // `A: Vermont | VT | the Green Mountain State` — alternates for the fuzzy
      // matcher; the first stays the display answer.
      variants = line.slice(2).split(' | ').map((s) => s.trim()).filter(Boolean)
      answer = variants[0] ?? ''
      return
    }
```

Update the header comment's `A:` line to mention the alternates:

```ts
 *   A: The answer | an alternate      required, so the host can judge
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --test shared/pack.test.ts && npm run typecheck`
Expected: PASS. Typecheck may flag `server/reader.test.ts`-era code constructing `Question` literals — if any exist, add `answers: [answer]` there; there are none as of `dddac75`.

- [ ] **Step 5: Commit**

```bash
git add shared/pack.ts shared/pack.test.ts
git commit -m "packs: answer alternates, split on ' | '"
```

---

### Task 2: The matcher

**Files:**
- Create: `server/match.ts`
- Test: `server/match.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `matchAnswer(transcript: string, answers: string[]): boolean`. The judge (Task 5) calls it.

- [ ] **Step 1: Write the failing tests**

Create `server/match.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchAnswer } from './match.ts'

test('an exact answer matches, any variant does', () => {
  assert.ok(matchAnswer('Vermont', ['Vermont']))
  assert.ok(matchAnswer('VT', ['Vermont', 'VT', 'the Green Mountain State']))
  assert.ok(matchAnswer('green mountain state', ['Vermont', 'VT', 'the Green Mountain State']))
})

test('case, punctuation and articles are ignored', () => {
  assert.ok(matchAnswer('THE Green-Mountain State!', ['the Green Mountain State']))
})

test('ordinary STT mangling within one or two edits still matches', () => {
  assert.ok(matchAnswer('vermant', ['Vermont']))
  assert.ok(matchAnswer('the green mountin state', ['the Green Mountain State']))
  assert.ok(matchAnswer('pair us', ['Paris']))
})

test('extra spoken words are ignored', () => {
  assert.ok(matchAnswer('uh, the green mountain state?', ['the Green Mountain State']))
})

test('a different answer is rejected', () => {
  assert.equal(matchAnswer('New Hampshire', ['Vermont']), false)
  assert.equal(matchAnswer('their mound', ['Vermont']), false)
  assert.equal(matchAnswer('green mountain', ['the Green Mountain State']), false)
})

test('an empty transcript never matches', () => {
  assert.equal(matchAnswer('', ['Vermont']), false)
  assert.equal(matchAnswer('the a an', ['Vermont']), false)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test server/match.test.ts`
Expected: FAIL — `Cannot find module './match.ts'`.

- [ ] **Step 3: Implement**

Create `server/match.ts`:

```ts
/**
 * The fuzzy answer matcher. Token-set plus bounded edit distance: a variant is
 * satisfied when every one of its content tokens has a transcript token within
 * reach, and anything else the player said is ignored.
 *
 * ponytail: this is a heuristic, not semantics. Genuinely equivalent phrasings
 * that STT renders far apart ("twenty" heard as "twenty-eight") will miss, and
 * the host's undo is the documented repair path. If misses pile up on real
 * audio, the upgrade is phonetic keys (metaphone) per token, in this one file.
 */

/** Lowercase, punctuation to spaces, articles dropped. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t !== '' && t !== 'a' && t !== 'an' && t !== 'the')
}

/** Levenshtein. Tokens are a handful of characters; the full matrix is fine. */
function edits(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/** Short tokens forgive one edit, longer ones two — a long word has more to mangle. */
const within = (a: string, b: string) => edits(a, b) <= (a.length <= 5 ? 1 : 2)

export function matchAnswer(transcript: string, answers: string[]): boolean {
  const heard = tokens(transcript)
  if (heard.length === 0) return false
  return answers.some((variant) => {
    const want = tokens(variant)
    // A variant that is all articles ("The") has nothing to hold against the
    // transcript; it must not match everything.
    if (want.length === 0) return false
    return want.every((w) => heard.some((h) => within(w, h)))
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test server/match.test.ts`
Expected: PASS (6 tests). If `pair us` vs `Paris` fails, check the token regex produced `['pair','us']` and `['paris']` — `us`↔`is` is one edit, `pair`↔`pari` is one edit; it should pass.

- [ ] **Step 5: Commit**

```bash
git add server/match.ts server/match.test.ts
git commit -m "judge: the fuzzy matcher — tokens within an edit or two"
```

---

### Task 3: The STT helper and its wrapper

The spike (`/tmp/stt-spike`) proved the path; this is the kept version. The one load-bearing finding: the helper must end in `RunLoop.main.run()` — parking the main thread on a semaphore starves the XPC setup to `speechd` and the recognition task never calls back.

**Files:**
- Create: `server/stt/stt.swift`
- Create: `server/stt.ts`
- Modify: `server/speech.ts` (export `run`)
- Test: `server/stt.test.ts`

**Interfaces:**
- Consumes: `run` from `server/speech.ts`.
- Produces:
  - `sttBinary(dir: string): Promise<string | null>` — builds `dir/stt` from `dir/stt.swift` when missing or older; `null` when the source or `swiftc` is absent.
  - `transcribe(bin: string, wavPath: string): Promise<string | null>` — stdout trimmed, `null` on any failure. The judge (Task 5) takes this as its `Transcribe` seam.

- [ ] **Step 1: Write the failing tests**

Create `server/stt.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sttBinary, transcribe } from './stt.ts'

function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pb-stt-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('a transcript comes back trimmed; a failing binary is a null, not a throw', async () => {
  await withDir(async (dir) => {
    const ok = join(dir, 'ok')
    writeFileSync(ok, '#!/bin/sh\necho "  the green mountain state  "\n')
    chmodSync(ok, 0o755)
    assert.equal(await transcribe(ok, '/tmp/whatever.wav'), 'the green mountain state')

    const bad = join(dir, 'bad')
    writeFileSync(bad, '#!/bin/sh\nexit 1\n')
    chmodSync(bad, 0o755)
    assert.equal(await transcribe(bad, '/tmp/whatever.wav'), null)

    assert.equal(await transcribe(join(dir, 'missing'), '/tmp/whatever.wav'), null)
  })
})

test('no stt.swift in the directory means no binary and no swiftc invocation', async () => {
  await withDir(async (dir) => {
    assert.equal(await sttBinary(dir), null)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test server/stt.test.ts`
Expected: FAIL — `Cannot find module './stt.ts'`.

- [ ] **Step 3: Export `run` from speech.ts**

In `server/speech.ts`, change `function run(` to `export function run(`. It is the same spawn-wrapper shape the judge needs; a second copy would be the duplication.

- [ ] **Step 4: Write the wrapper**

Create `server/stt.ts`:

```ts
/**
 * Speech-to-text, one spawn per answer. The helper is a few dozen lines of
 * Swift built by `swiftc` on demand at server boot — the same machine-binary
 * posture as `say`/`afplay`/`ffmpeg`, never an npm dependency. Without the
 * source or the compiler every call degrades to null and the judge stays off,
 * the way speech.ts degrades to silence.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './speech.ts'

/**
 * The path to a working helper, or null. Rebuilds when the source is newer, so
 * an edit to stt.swift takes effect on the next boot with nothing to remember.
 */
export async function sttBinary(dir: string): Promise<string | null> {
  const src = join(dir, 'stt.swift')
  const bin = join(dir, 'stt')
  if (!existsSync(src)) return null
  const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs
  if (!fresh) {
    const { ok } = await run('swiftc', ['-O', '-o', bin, src])
    if (!ok) {
      console.warn('[stt] swiftc build failed — spoken answers are off, the host judges')
      return null
    }
  }
  return bin
}

/** One file in, one transcript out. Any failure is a null: the caller scores a miss. */
export async function transcribe(bin: string, wavPath: string): Promise<string | null> {
  const { ok, stdout } = await run(bin, [wavPath])
  if (!ok) return null
  return stdout.trim() || null
}
```

- [ ] **Step 5: Write the Swift helper**

Create `server/stt/stt.swift`:

```swift
// One audio file in (argv 1), one transcript out (stdout). On-device, so party
// WiFi — which has no route to the internet — is enough. Built by swiftc at
// server boot; see server/stt.ts.
import Speech
import AVFoundation
import Foundation

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: stt <audio-file>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let fail = { (msg: String, _ code: Int32) -> Never in
    FileHandle.standardError.write("\(msg)\n".data(using: .utf8)!)
    exit(code)
}

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else { fail("speech recognition not authorized (\(status.rawValue))", 1) }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
        fail("recognizer unavailable", 1)
    }
    let request = SFSpeechAudioBufferRecognitionRequest()
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error { fail("recognition: \(error.localizedDescription)", 1) }
        guard let result, result.isFinal else { return }
        print(result.bestTranscription.formattedString)
        exit(0)
    }
    _ = task
    do {
        let file = try AVAudioFile(forReading: url)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat,
                                            frameCapacity: AVAudioFrameCount(file.length)) else {
            fail("buffer alloc failed", 1)
        }
        try file.read(into: buffer)
        request.append(buffer)
        request.endAudio()
    } catch {
        fail("read: \(error.localizedDescription)", 1)
    }
}

DispatchQueue.global().asyncAfter(deadline: .now() + 30) { fail("timeout", 1) }
// XPC to speechd is set up on the main runloop. Parking the main thread on a
// semaphore starves it, and the task then never calls back — the one failure
// mode the spike actually hit.
RunLoop.main.run()
```

- [ ] **Step 6: Run the tests, then build the helper for real**

Run: `node --test server/stt.test.ts && npm run typecheck`
Expected: PASS, clean.

Then prove the Swift half on this machine (it is the one thing node:test cannot reach):

Run: `swiftc -O -o server/stt/stt server/stt/stt.swift && say -o /tmp/pb-warm.aiff "the answer is Vermont" && server/stt/stt /tmp/pb-warm.aiff`
Expected: prints something close to `The answer is Vermont`. If a "Terminal wants Speech Recognition" dialog appears, accept it — a fresh machine prompts once. Do not commit the built binary; check `.gitignore` covers `server/stt/stt` and add that line if it does not.

- [ ] **Step 7: Commit**

```bash
git add server/stt.ts server/stt.test.ts server/stt/stt.swift server/speech.ts .gitignore
git commit -m "judge: on-device speech-to-text, one swiftc-built helper per box"
```

---

### Task 4: The contract

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/state.ts`
- Test: `server/state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Round.judge?: { until?: number }` — present = the judge is live for the locked-in leader; `until` present = a server-domain deadline, absent = open-ended.
  - `Round.spoken?: { name: string; transcript: string; hit: boolean }`.
  - `State.answerWindowSec: number` (default 10; 0 = no timeout).
  - `HostAction` variant `{ a: 'setAnswerWindow'; sec: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/state.test.ts`:

```ts
test('setAnswerWindow clamps to 0..120 whole seconds', () => {
  const state = newState()
  applyHostAction(state, { a: 'setAnswerWindow', sec: 45.7 })
  assert.equal(state.answerWindowSec, 46)
  applyHostAction(state, { a: 'setAnswerWindow', sec: -3 })
  assert.equal(state.answerWindowSec, 0)
  applyHostAction(state, { a: 'setAnswerWindow', sec: 9999 })
  assert.equal(state.answerWindowSec, 120)
})

test('arm sweeps the judge window and the last spoken answer', () => {
  const state = newState()
  state.round.judge = { until: 123 }
  state.round.spoken = { name: 'Ada', transcript: 'vermont', hit: true }
  applyHostAction(state, { a: 'arm' })
  assert.equal(state.round.judge, undefined)
  assert.equal(state.round.spoken, undefined)
})

test('a verdict ends the window but the transcript rides out the rebound', () => {
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }]
  applyHostAction(state, { a: 'arm' })
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'a', name: 'Ada', at: state.round.armedAt, deltaMs: 0 }]
  state.round.judge = {}
  state.round.spoken = { name: 'Ada', transcript: 'vermont', hit: false }
  applyHostAction(state, { a: 'wrong', neg: 100 })
  assert.equal(state.round.judge, undefined, 'the window is over')
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'vermont', hit: false })
})

test('next clears both', () => {
  const state = newState()
  state.round.judge = {}
  state.round.spoken = { name: 'Ada', transcript: 'x', hit: true }
  applyHostAction(state, { a: 'next' })
  assert.equal(state.round.judge, undefined)
  assert.equal(state.round.spoken, undefined)
})
```

Check the imports at the top of `server/state.test.ts` cover `newState` and `applyHostAction` (they do as of `dddac75`).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test --test-name-pattern="setAnswerWindow|judge window|rebound|next clears" server/state.test.ts`
Expected: FAIL — `setAnswerWindow` is not a known action variant (type error), and the sweep assertions fail.

- [ ] **Step 3: Add the types**

In `shared/protocol.ts`, in `Round`, beside `award`:

```ts
  /**
   * The judge's offer to the locked-in leader. Present means push-to-talk is
   * live; `until` is the server-domain deadline, absent means the host ends a
   * stall by hand. Swept with the next arm; ended by any verdict.
   */
  judge?: { until?: number }
  /**
   * What the locked-in player said and how it scored. Kept through a rebound —
   * the room heard it — and cleared on the next arm.
   */
  spoken?: { name: string; transcript: string; hit: boolean }
```

In `State`, beside `mirrorFragments`:

```ts
  /** Seconds a locked-in player has to speak before silence scores wrong. 0 = no timeout. */
  answerWindowSec: number
```

In `HostAction`, beside `setValue`:

```ts
  | { a: 'setAnswerWindow'; sec: number }
```

- [ ] **Step 4: Implement the state-machine side**

In `server/state.ts`, `newState()`, beside `mirrorFragments: false`:

```ts
    // Ten seconds of silence is a stall. Only ever read by the judge, which
    // only runs while the reader drives a pack, so host-read games never feel it.
    answerWindowSec: 10,
```

In `loadState()`, beside the `mirrorFragments` line:

```ts
    if (typeof loaded.answerWindowSec !== 'number') loaded.answerWindowSec = 10
```

In the `arm` branch, beside `delete round.answer`:

```ts
      delete round.judge
      delete round.spoken
```

In the `correct` branch, after `round.lockedOut = []`:

```ts
      // The window is over; the transcript stays up beside the award.
      delete round.judge
```

In the `wrong` branch, after `delete round.award`:

```ts
      // Same: the verdict ended the window, but what was said rides the rebound.
      delete round.judge
```

In the `next` / `resetRound` branch, beside `delete round.answer` (if the game-flow plan has landed, this branch has an `advanceFlow` call at its end — add these beside the other deletes, not at the end):

```ts
      delete round.judge
      delete round.spoken
```

Add the action branch, after `setValue`:

```ts
    case 'setAnswerWindow':
      state.answerWindowSec = Math.min(120, Math.max(0, Math.round(action.sec) || 0))
      return
```

- [ ] **Step 5: Run the tests**

Run: `node --test server/state.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol.ts server/state.ts server/state.test.ts
git commit -m "judge: the contract — a window offer, a spoken line, a timeout setting"
```

---

### Task 5: The judge, and the two acts it speaks

**Files:**
- Create: `server/judge.ts`
- Test: `server/judge.test.ts`
- Modify: `server/hub.ts` (the `act` chain, after the `revealAnswer` branch ~line 184)
- Modify: `server/reader.ts` (`ReaderOpts` ~line 24; `run()` arm site ~line 161; `stop()` ~line 125)

**Interfaces:**
- Consumes: `matchAnswer` (Task 2); `Round.judge`/`spoken`, `State.answerWindowSec` (Task 4); `Question.answers` (Task 1).
- Produces:
  - `type Transcribe = (wavPath: string) => Promise<string | null>`
  - `class Judge` with `constructor(hub: Hub, opts: JudgeOpts)`, `prime(answers: string[]): void`, `unprime(): void`, `onStateChange(): void`, `submit(playerId: PlayerId, body: Buffer, isText: boolean): Promise<AnswerResult>` where `AnswerResult = { ok: true; hit: boolean; transcript: string } | { ok: false }` and `JudgeOpts = { transcribe?: Transcribe }`.
  - Hub acts: `judgeWindow` (data `{ until?: number }` to open, `undefined` to close) and `spoken` (data `Round['spoken']`). Host-scoped, beside the reader's acts.
  - `ReaderOpts.judge?: Judge`. The reader primes at arm and unprimes at stop.

- [ ] **Step 1: Write the failing tests**

Create `server/judge.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import { Judge, type Transcribe } from './judge.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'
import { ARM_LEAD_MS } from '../shared/protocol.ts'

const hostConn: Conn = { id: 'h', role: 'host', send: () => {} }

function rig(transcribe: Transcribe = async () => 'unused') {
  const state = newState()
  state.answerWindowSec = 0 // open-ended unless a test asks for a timeout
  const hub = new Hub(state, { collectMs: 40, revealMs: 10 })
  const judge = new Judge(hub, { transcribe })
  hub.setOnChange(() => judge.onStateChange())
  const ada: Conn = { id: 'a', role: 'player', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada' })
  return { state, hub, judge, ada }
}

/** Arm, buzz Ada the instant the buzzers open, and wait out the lock. */
async function lockIn(hub: Hub, ada: Conn): Promise<void> {
  hub.handle(hostConn, { t: 'host', action: { a: 'arm' } })
  const armedAt = hub.state.round.armedAt
  await sleep(armedAt - Date.now() + 5)
  hub.handle(ada, { t: 'buzz', at: armedAt })
  await sleep(80) // collectMs 40 + slack
  assert.equal(hub.state.round.phase, 'LOCKED')
}

test('a lock while primed opens the window; open-ended when the timeout is off', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  assert.deepEqual(state.round.judge, {})
})

test('a timeout setting puts a server-domain deadline on the window', async () => {
  const { state, hub, judge, ada } = rig()
  state.answerWindowSec = 5
  judge.prime(['Vermont'])
  const before = Date.now()
  await lockIn(hub, ada)
  const until = state.round.judge?.until ?? 0
  assert.ok(until >= before + 5000 && until <= Date.now() + 5000, `until=${until}`)
})

test('a matching answer scores correct through the ordinary host path', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont', 'VT'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('uh, vermont?'), true)
  assert.deepEqual(res, { ok: true, hit: true, transcript: 'uh, vermont?' })
  assert.equal(state.round.phase, 'IDLE')
  assert.deepEqual(state.round.award, { name: 'Ada', points: 100 })
  assert.equal(state.scores[ada.playerId!], 100)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'uh, vermont?', hit: true })
  assert.equal(state.round.judge, undefined, 'the verdict ended the window')
})

test('a miss is a wrong at full value, and the rebound re-arms', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('new hampshire'), true)
  assert.deepEqual(res, { ok: true, hit: false, transcript: 'new hampshire' })
  assert.equal(state.round.phase, 'ARMED', 'rebound')
  assert.equal(state.scores[ada.playerId!], -100)
  assert.equal(state.round.judge, undefined)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'new hampshire', hit: false })
})

test('silence past the window lapses to the same wrong', async () => {
  const { state, hub, judge, ada } = rig()
  // Sub-second, poked directly: the setAnswerWindow action is whole seconds,
  // and no test should wait five of them.
  state.answerWindowSec = 0.05
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  await sleep(150)
  assert.equal(state.round.phase, 'ARMED', 'lapsed to a rebound')
  assert.equal(state.scores[ada.playerId!], -100)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: '', hit: false })
})

test('anything that is not the leader in the open window is refused', async () => {
  const { hub, judge, ada } = rig()
  const bo: Conn = { id: 'b', role: 'player', send: () => {} }
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  judge.prime(['Vermont'])
  assert.deepEqual(await judge.submit(ada.playerId!, Buffer.from('x'), true), { ok: false },
    'no window open yet')
  await lockIn(hub, ada)
  assert.deepEqual(await judge.submit(bo.playerId!, Buffer.from('vermont'), true), { ok: false },
    'not the leader')
})

test('a host W mid-transcription wins; the late verdict drops on the phase guard', async () => {
  let release: (t: string | null) => void = () => {}
  const slow: Transcribe = () => new Promise((r) => (release = r))
  const { state, hub, judge, ada } = rig(slow)
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  const pending = judge.submit(ada.playerId!, Buffer.from('RIFF….'), false)
  await sleep(10)
  hub.handle(hostConn, { t: 'host', action: { a: 'wrong', neg: 100 } })
  assert.equal(state.round.phase, 'ARMED')
  release('vermont')
  const res = await pending
  assert.equal(res.ok, true)
  assert.equal(state.round.phase, 'ARMED', 'the late verdict did not score')
  assert.equal(state.scores[ada.playerId!], -100, 'and did not dock twice')
  assert.equal(state.round.lockedOut.length, 1)
})

test('the audio path hands transcribe a wav file and cleans it up', async () => {
  let seen = ''
  const peek: Transcribe = async (path) => {
    seen = path
    assert.ok(existsSync(path), 'the file exists while transcribe runs')
    return 'VT'
  }
  const { state, hub, judge, ada } = rig(peek)
  judge.prime(['Vermont', 'VT'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('RIFF….'), false)
  assert.equal(res.ok, true)
  assert.ok(seen.endsWith('.wav'))
  assert.equal(existsSync(seen), false, 'the temp file is gone afterwards')
  assert.equal(state.round.award?.points, 100)
})

/** Speech that plays instantly. Same fake as reader.test.ts. */
function fakeSpeech(): Speech {
  return {
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: () => ({ done: Promise.resolve(), stop: () => {} }),
  }
}

test('the reader primes at arm and unprimes at stop — the full loop in-process', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-judge-'))
  writeFileSync(join(packDir, 'one.txt'), 'A question. / More of it.\nA: gold | the gold one\n')
  const state = newState()
  state.answerWindowSec = 0
  const hub = new Hub(state, { collectMs: 40, revealMs: 10 })
  const judge = new Judge(hub, { transcribe: async () => 'unused' })
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech: fakeSpeech(), judge })
  hub.setOnChange((s) => {
    reader.onStateChange(s)
    judge.onStateChange()
  })
  const ada: Conn = { id: 'a', role: 'player', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada' })

  await reader.select('one.txt')
  reader.start()
  await sleep(ARM_LEAD_MS + 30)
  await lockIn(hub, ada)
  assert.ok(state.round.judge !== undefined, 'primed at arm, the window opened')

  const res = await judge.submit(ada.playerId!, Buffer.from('the gold one'), true)
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.hit, true)

  reader.stop()
  await reader.settled()
  assert.equal(state.round.judge, undefined, 'stop unprimed and closed')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/judge.test.ts`
Expected: FAIL — `Cannot find module './judge.ts'`, and `ReaderOpts` has no `judge`.

- [ ] **Step 3: Add the two acts to the hub**

In `server/hub.ts`, in `act`, after the `revealAnswer` branch:

```ts
    } else if (name === 'judgeWindow') {
      // The judge's offer to the locked-in leader. {} is the open-ended window:
      // present means "offer push-to-talk", and only `until` carries a countdown.
      const d = data as { until?: number } | undefined
      if (d) round.judge = typeof d.until === 'number' ? { until: d.until } : {}
      else delete round.judge
    } else if (name === 'spoken') {
      round.spoken = (data ?? undefined) as State['round']['spoken']
    }
```

- [ ] **Step 4: Write the judge**

Create `server/judge.ts`:

```ts
/**
 * The judge: scores spoken answers while the reader drives a pack.
 *
 * It watches the same state stream the reader waits on, opens an answer window
 * when a round locks with a leader while primed, and returns its verdict as
 * ordinary host actions through a synthetic host connection — undo, validation,
 * rebound and the reader's wait-for-award loop all apply unchanged, and the hub
 * grows no judge-shaped API.
 *
 * The pack's answers are primed by the reader at arm time and live in memory
 * only, never in State. No prime — or no speech-to-text helper — and the judge
 * simply opens no windows, which is the whole degradation story: the phone
 * never offers push-to-talk and the host judges by hand, exactly as today.
 */
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { matchAnswer } from './match.ts'
import type { Hub, Conn } from './hub.ts'
import type { PlayerId } from '../shared/protocol.ts'

/** Speech-to-text, injected so tests never touch the Swift helper. */
export type Transcribe = (wavPath: string) => Promise<string | null>

export type JudgeOpts = {
  /** Absent = the judge is off: it opens no windows and the host judges. */
  transcribe?: Transcribe
}

export type AnswerResult = { ok: true; hit: boolean; transcript: string } | { ok: false }

export class Judge {
  private hub: Hub
  private transcribe: Transcribe | undefined
  private conn: Conn = { id: 'judge', role: 'host', send: () => {} }
  /** The current question's answer variants. Memory only — never State. */
  private primed: string[] | undefined
  /** `${armedAt}:${leaderId}` for the open window, so repeat broadcasts don't re-open it. */
  private windowKey: string | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(hub: Hub, opts: JudgeOpts = {}) {
    this.hub = hub
    this.transcribe = opts.transcribe
  }

  /** The reader calls this at arm time with the question's answer variants. */
  prime(answers: string[]): void {
    this.primed = answers
  }

  unprime(): void {
    this.primed = undefined
    if (!this.windowKey) return
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
  }

  /** Called from the hub's onChange. */
  onStateChange(): void {
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader || !this.primed || !this.transcribe) {
      // Anything that left LOCKED — a verdict, a host W, a next — ends the window.
      if (this.windowKey && state.round.phase !== 'LOCKED') this.closeWindow()
      return
    }
    const key = `${state.round.armedAt}:${leader.playerId}`
    if (key === this.windowKey) return
    this.closeWindow()
    this.windowKey = key
    const sec = state.answerWindowSec
    const until = sec > 0 ? Date.now() + sec * 1000 : undefined
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: until ? { until } : {} })
    if (until) {
      this.timer = setTimeout(() => this.lapse(key), sec * 1000)
      this.timer.unref?.()
    }
  }

  /**
   * One answer per window. Anything that isn't the current leader inside the
   * open window — a late packet after a rebound, a bystander's phone — is
   * refused, and the caller turns that into a 409.
   */
  async submit(playerId: PlayerId, body: Buffer, isText: boolean): Promise<AnswerResult> {
    const state = this.hub.state
    const leader = state.round.order[0]
    if (
      !this.primed ||
      !this.windowKey ||
      state.round.phase !== 'LOCKED' ||
      leader?.playerId !== playerId
    ) {
      return { ok: false }
    }
    const answers = this.primed
    const name = leader.name
    const neg = state.round.value
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })

    const transcript = isText ? body.toString('utf8').trim() : await this.hear(body)
    const hit = !!transcript && matchAnswer(transcript, answers)
    // Shown before the verdict lands, so what was said is on the board even
    // when the host's own C or W beat the judge to it — the verdict then drops
    // on the LOCKED guard in applyHostAction, and the transcript stays true.
    this.hub.send(this.conn, { t: 'act', act: 'spoken', data: { name, transcript, hit } })
    this.hub.send(this.conn, { t: 'host', action: hit ? { a: 'correct' } : { a: 'wrong', neg } })
    return { ok: true, hit, transcript }
  }

  private async hear(body: Buffer): Promise<string> {
    const path = join(tmpdir(), `buzzer-answer-${randomUUID()}.wav`)
    try {
      writeFileSync(path, body)
      return (await this.transcribe?.(path)) ?? ''
    } finally {
      rmSync(path, { force: true })
    }
  }

  /** The window ran out with no answer: silence is a wrong, through the same path. */
  private lapse(key: string): void {
    if (this.windowKey !== key) return
    const state = this.hub.state
    const leader = state.round.order[0]
    if (state.round.phase !== 'LOCKED' || !leader) return
    const neg = state.round.value
    this.closeWindow()
    this.hub.send(this.conn, { t: 'act', act: 'judgeWindow', data: undefined })
    this.hub.send(this.conn, {
      t: 'act',
      act: 'spoken',
      data: { name: leader.name, transcript: '', hit: false },
    })
    this.hub.send(this.conn, { t: 'host', action: { a: 'wrong', neg } })
  }

  private closeWindow(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.windowKey = undefined
  }
}
```

- [ ] **Step 5: Prime from the reader**

In `server/reader.ts`, import the type and add the option:

```ts
import type { Judge } from './judge.ts'
```

```ts
export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
  /** The judge scores the spoken answer; absent, the host judges as always. */
  judge?: Judge
}
```

In `run()`, immediately after the `arm` send:

```ts
      this.hub.send(this.conn, { t: 'host', action: { a: 'arm' } })
      // Answer variants, memory only — this is the one path by which the judge
      // ever learns what the room is about to be asked.
      this.opts.judge?.prime(q.answers)
```

In `stop()`, beside the `reading` clear:

```ts
    this.opts.judge?.unprime()
```

- [ ] **Step 6: Run the tests**

Run: `node --test server/judge.test.ts server/reader.test.ts server/hub.test.ts && npm run typecheck`
Expected: PASS (9 new tests, the neighbours undisturbed), clean.

- [ ] **Step 7: Commit**

```bash
git add server/judge.ts server/judge.test.ts server/hub.ts server/reader.ts
git commit -m "judge: the answer window, the verdict, and the reader's prime"
```

---

### Task 6: The wire-up — POST /answer and the boot

**Files:**
- Modify: `server/index.ts` (options ~line 61; server body ~line 71-99)
- Modify: `server/e2e.ts` (`withServer` ~line 72)

**Interfaces:**
- Consumes: `Judge`, `Transcribe` (Task 5); `sttBinary`, `transcribe` (Task 3); `render` from `server/speech.ts` (already exported).
- Produces: `startServer` option `transcribe?: Transcribe | null` — `undefined` builds the Swift helper and uses it, `null` disables the judge, a function injects a stub. `POST /answer?player=<id>`: `text/plain` body = transcript, anything else = WAV; 200 with the `AnswerResult` JSON, 409 when refused.

- [ ] **Step 1: Disable the judge in the test harness**

In `server/e2e.ts`, add to the `startServer` call in `withServer`:

```ts
    // No speech-to-text in tests: boot must never invoke swiftc.
    transcribe: null,
```

(If the game-flow plan has landed, its `flowDir` line is right beside this — both stay.)

- [ ] **Step 2: Wire the judge into startServer**

In `server/index.ts`, extend the imports:

```ts
import { Judge, type Transcribe } from './judge.ts'
import { sttBinary, transcribe as sttTranscribe } from './stt.ts'
import { render as renderClip } from './speech.ts'
```

Extend the options type:

```ts
  /** Speech-to-text for the judge. Undefined builds the helper; null disables it. */
  transcribe?: Transcribe | null
```

In `startServer`, after the hub/reader wiring (replacing the `new Reader(...)` and `setOnChange` block):

```ts
  let transcribe = opts.transcribe ?? undefined
  let realStt = false
  if (opts.transcribe === undefined) {
    const bin = await sttBinary(join(ROOT, 'server/stt'))
    if (bin) {
      transcribe = (wav) => sttTranscribe(bin, wav)
      realStt = true
    }
  }
  const judge = new Judge(hub, { transcribe })

  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), judge })
  hub.setReader(reader)
  // Both subscribers, now that all three exist: the snapshot, the reader's
  // waits, and the judge's window.
  hub.setOnChange((s) => {
    saveState(statePath, s)
    reader.onStateChange(s)
    judge.onStateChange()
  })

  // The first transcription pays the model load (seconds cold, ~180ms warm),
  // and game night is not when to discover that. One throwaway clip at boot
  // warms speechd; the clip caches like any other, so this costs once ever.
  if (realStt && transcribe) {
    const hear = transcribe
    void renderClip(join(packDir, '.cache'), 'Warming up.').then((clip) => {
      if (clip.durationMs > 0) return hear(clip.path)
    })
  }
```

- [ ] **Step 3: Add the route**

In the `createServer` callback, before the `serveStatic` fallthrough:

```ts
    if (req.method === 'POST' && (req.url ?? '').startsWith('/answer')) {
      const player = new URL(req.url ?? '/', 'http://localhost').searchParams.get('player') ?? ''
      // text/plain is the transcript itself — probe's speak: step and tests.
      // Anything else is a recording to transcribe.
      const isText = (req.headers['content-type'] ?? '').startsWith('text/plain')
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= 2_000_000) chunks.push(c)
      })
      req.on('end', () => {
        // Six seconds of mono 16-bit WAV at 48kHz is 576KB; 2MB is generous.
        if (size > 2_000_000) {
          res.writeHead(413).end('too large')
          return
        }
        void judge.submit(player, Buffer.concat(chunks), isText).then((r) => {
          res.writeHead(r.ok ? 200 : 409, { 'content-type': 'application/json' })
          res.end(JSON.stringify(r))
        })
      })
      return
    }
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all pass, clean. This task's route is thin glue over the tested judge; `probe`'s `speak:` step (Task 11) is its end-to-end check, and the checklist entry is its real-audio one. No HTTP test — booting a reader against a real pack in node:test would render clips with the real `say`.

Then boot it for real:

Run: `NO_OPEN=1 npm start`, wait for the banner, then Ctrl-C.
Expected: no `[stt]` warning on this machine (the helper built in Task 3), no other new output.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/e2e.ts
git commit -m "judge: POST /answer, and a warm speechd by the time the room sits down"
```

---

### Task 7: The host setting and the host's spoken line

**Files:**
- Modify: `client/Host.tsx` (the `host__reader` block ~line 146; after `host__minor` ~line 144)
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `State.answerWindowSec`, `{ a: 'setAnswerWindow' }` (Task 4); `round.spoken` (Task 4).
- Produces: nothing new downstream.

- [ ] **Step 1: The setting**

In `client/Host.tsx`, inside the `host__reader` div, after the pack `</label>`:

```tsx
            <label class="field">
              Answer window
              <input
                class="input input--num"
                type="number"
                min={0}
                max={120}
                value={state.answerWindowSec}
                onInput={(e) =>
                  act({ a: 'setAnswerWindow', sec: Number((e.target as HTMLInputElement).value) })
                }
              />
              <span class="muted">sec · 0 = you end a stall by hand</span>
            </label>
```

- [ ] **Step 2: The spoken line**

Directly after the `host__minor` div (before the reader block):

```tsx
        {/* What the locked-in player said, as the judge heard it. The verdict
            itself is the award above; this is the evidence for the undo. */}
        {round.spoken && (
          <p class={round.spoken.hit ? 'host__spoken is-hit' : 'host__spoken is-miss'}>
            “{round.spoken.transcript || 'no answer'}” — {round.spoken.name}
          </p>
        )}
```

- [ ] **Step 3: Style**

In `client/style.css`, beside the other `host__` rules:

```css
/* The judge's transcript: brass when it scored, tally-red when it did not. */
.host__spoken {
  margin: var(--s3) 0 0;
  color: var(--dim);
}
.host__spoken.is-hit { color: var(--brass); }
.host__spoken.is-miss { color: var(--tally); }
```

- [ ] **Step 4: Build and look at it**

Run: `npm run build && npm run typecheck`
Then `npm start`, and in another terminal `npm run probe -- join:Ada arm` (a pack read is what primes the judge — for this task, eyeball only that the input renders in the reader section and accepts 0; the live loop is Task 11's probe).

- [ ] **Step 5: Commit**

```bash
git add client/Host.tsx client/style.css
git commit -m "judge: the answer-window setting and the host's transcript line"
```

---

### Task 8: Client audio — WAV encoder and the buffered recorder

**Files:**
- Create: `client/wav.ts`
- Test: `client/wav.test.ts`
- Create: `client/recorder.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `encodeWav(samples: Float32Array, rate: number): ArrayBuffer` (mono 16-bit PCM).
  - `class Recorder` with `start(stream: MediaStream): Promise<void>`, `mark(): void`, `cut(): { samples: Float32Array; rate: number }`, `stop(): void`. Player.tsx (Task 9) is the only consumer.

- [ ] **Step 1: Write the failing tests**

Create `client/wav.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav } from './wav.ts'

test('the header is a well-formed mono 16-bit WAV at the given rate', () => {
  const buf = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000)
  const v = new DataView(buf)
  const str = (off: number, n: number) =>
    String.fromCharCode(...new Uint8Array(buf, off, n))
  assert.equal(str(0, 4), 'RIFF')
  assert.equal(v.getUint32(4, true), 36 + 6)
  assert.equal(str(8, 4), 'WAVE')
  assert.equal(str(12, 4), 'fmt ')
  assert.equal(v.getUint16(20, true), 1, 'PCM')
  assert.equal(v.getUint16(22, true), 1, 'mono')
  assert.equal(v.getUint32(24, true), 16000)
  assert.equal(str(36, 4), 'data')
  assert.equal(v.getUint32(40, true), 6)
  assert.equal(buf.byteLength, 44 + 6)
})

test('samples clamp and scale to 16-bit', () => {
  const buf = encodeWav(new Float32Array([1, -1, 2, -2]), 8000)
  const pcm = new Int16Array(buf, 44)
  assert.deepEqual([...pcm], [32767, -32768, 32767, -32768])
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test client/wav.test.ts`
Expected: FAIL — `Cannot find module './wav.ts'`.

- [ ] **Step 3: The encoder**

Create `client/wav.ts`:

```ts
/**
 * Mono 16-bit PCM WAV. WAV sidesteps the browser codec lottery — Safari gives
 * MediaRecorder AAC, Chrome Opus-in-WebM, and stock macOS cannot decode the
 * latter — and SFSpeech reads it directly. The header carries the real rate,
 * so no resampling step earns its place.
 */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength)
  const v = new DataView(buf)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  new Int16Array(buf, 44).set(pcm)
  return buf
}
```

- [ ] **Step 4: The recorder**

Create `client/recorder.ts`:

```ts
/**
 * Buffered mic capture for push-to-talk.
 *
 * The worklet runs from the moment the player locks in — not from pointerdown —
 * so an answer that starts with the finger keeps its first syllable.
 * pointerdown only marks; pointerup cuts from the mark to now.
 *
 * The worklet source rides a blob URL: no build plumbing, no extra asset, and
 * the whole thing is the twenty lines below.
 */
const WORKLET = `
registerProcessor('pb-recorder', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
})`

export class Recorder {
  private ctx: AudioContext | undefined
  private node: AudioWorkletNode | undefined
  private chunks: Float32Array[] = []
  private buffered = 0
  private markAt = 0
  private rate = 48000

  /** Start buffering. The stream is the caller's — permission came at join. */
  async start(stream: MediaStream): Promise<void> {
    this.stop()
    const ctx = new AudioContext()
    this.ctx = ctx
    this.rate = ctx.sampleRate
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = ctx.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(ctx, 'pb-recorder')
    this.chunks = []
    this.buffered = 0
    this.markAt = 0
    this.node.port.onmessage = (e) => {
      const chunk = e.data as Float32Array
      this.chunks.push(chunk)
      this.buffered += chunk.length
      // Keep the last ~10s: an answer never needs more, and a lock-in the host
      // stalls on should not grow a buffer for the whole stall.
      while (this.buffered > this.rate * 10 && this.chunks.length > 1) {
        const dropped = this.chunks.shift()!
        this.buffered -= dropped.length
        this.markAt = Math.max(0, this.markAt - dropped.length)
      }
    }
    source.connect(this.node)
    // Nothing to the destination: capture, not monitoring.
  }

  /** pointerdown. */
  mark(): void {
    this.markAt = this.buffered
  }

  /** pointerup: everything since the mark, and the rate it was captured at. */
  cut(): { samples: Float32Array; rate: number } {
    const all = new Float32Array(this.buffered)
    let off = 0
    for (const c of this.chunks) {
      all.set(c, off)
      off += c.length
    }
    return { samples: all.slice(this.markAt), rate: this.rate }
  }

  stop(): void {
    this.node?.disconnect()
    this.node = undefined
    void this.ctx?.close()
    this.ctx = undefined
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `node --test client/wav.test.ts && npm run typecheck`
Expected: PASS, clean. The recorder itself has no node:test — it is a thin shell over browser audio APIs; the motion harness cannot drive a mic, so the manual checklist (Task 11) carries its verification.

- [ ] **Step 6: Commit**

```bash
git add client/wav.ts client/wav.test.ts client/recorder.ts
git commit -m "judge: phone audio — a WAV encoder and a buffered recorder"
```

---

### Task 9: The push-to-talk zone

**Files:**
- Modify: `client/Player.tsx` (join ~line 181; derived state ~line 97; the buzzer ~line 380)
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `Recorder`, `encodeWav` (Task 8); `round.judge`, `state.answerWindowSec` (Task 4).
- Produces: `POST /answer?player=<id>` with a WAV body.

- [ ] **Step 1: Permission at join**

In `client/Player.tsx`, in `join()` after `audio.current.resume()`:

```ts
    // Mic permission, asked once up front inside the same mandatory tap. The
    // stream itself opens on lock-in — this is only the dialog, so that the
    // first answer of the night is not spent staring at it.
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        micOk.current = true
        for (const t of s.getTracks()) t.stop()
      })
      .catch(() => {})
```

Add the refs beside `audio`:

```ts
  const micOk = useRef(false)
  const micStream = useRef<MediaStream | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const [talking, setTalking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const dragY = useRef(0)
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
```

and the imports:

```ts
import { Recorder } from './recorder.ts'
import { encodeWav } from './wav.ts'
```

- [ ] **Step 2: The derived flag and the capture effect**

Beside the `won` derivation:

```ts
  // This phone is the locked-in leader and the judge is listening.
  const talk = won && round?.phase === 'LOCKED' && !!round?.judge
```

Above the `if (!ready)` guard (hooks before early returns):

```ts
  // The mic opens on lock-in and closes with the window.
  useEffect(() => {
    if (!talk || !micOk.current) return
    let dead = false
    const rec = new Recorder()
    recorder.current = rec
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(async (stream) => {
      if (dead) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      micStream.current = stream
      await rec.start(stream)
      if (dead) rec.stop()
    })
    return () => {
      dead = true
      recorder.current = null
      rec.stop()
      for (const t of micStream.current?.getTracks() ?? []) t.stop()
      micStream.current = null
      setTalking(false)
      setCancelling(false)
    }
  }, [talk])
```

- [ ] **Step 3: The gestures**

Beside `buzz()`:

```ts
  const MAX_ANSWER_MS = 6000

  const sendAnswer = () => {
    const rec = recorder.current
    if (!rec) return
    const { samples, rate } = rec.cut()
    // A tap is not an answer; a tenth of a second of room tone would only
    // transcribe to garbage and cost the player their neg.
    if (samples.length < rate * 0.25) return
    void fetch(`/answer?player=${playerId}`, {
      method: 'POST',
      body: encodeWav(samples, rate),
    })
  }

  const talkDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    // Capture the pointer: the drag-down cancel leaves the button, and the
    // move/up events still have to land here.
    e.currentTarget.setPointerCapture(e.pointerId)
    dragY.current = e.clientY
    recorder.current?.mark()
    setTalking(true)
    setCancelling(false)
    clearTimeout(capTimer.current)
    capTimer.current = setTimeout(() => {
      // Six seconds is plenty for a quizbowl answer; past that, send what
      // there is rather than holding the round hostage to a stuck finger.
      setTalking(false)
      setCancelling(false)
      sendAnswer()
    }, MAX_ANSWER_MS)
  }

  const talkMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (talking) setCancelling(e.clientY - dragY.current > 60)
  }

  const talkUp = () => {
    if (!talking) return
    setTalking(false)
    clearTimeout(capTimer.current)
    if (cancelling) {
      // Drag-down cancelled; hold again to redo. That is the re-record.
      setCancelling(false)
      return
    }
    sendAnswer()
  }
```

(`JSX.TargetedPointerEvent` comes from `import type { JSX } from 'preact'` — a bare DOM `PointerEvent` type does not satisfy preact's handler signature.)

- [ ] **Step 4: The zone**

Replace the buzzer block with:

```tsx
      {talk ? (
        <button
          class={`buzzer is-first buzzer--talk${talking ? ' is-talking' : ''}${cancelling ? ' is-cancelling' : ''}`}
          onPointerDown={talkDown}
          onPointerMove={talkMove}
          onPointerUp={talkUp}
          onPointerCancel={talkUp}
        >
          {talking ? (cancelling ? 'Let go to cancel' : 'Let go to send') : 'Hold to answer'}
          <span class="buzzer__sub">
            {talking && !cancelling
              ? 'drag down to cancel'
              : round?.judge?.until
                ? <TalkCountdown until={round.judge.until} capSec={state?.answerWindowSec ?? 0} now={now} />
                : 'answer when ready'}
          </span>
        </button>
      ) : (
        <button
          class={`buzzer ${mood}`}
          onPointerDown={buzz}
          disabled={!open || barred || pressed || frozen || spectator}
        >
          {label}
          {sub && <span class="buzzer__sub">{sub}</span>}
        </button>
      )}
```

Add the countdown component above `Player()`:

```tsx
/** The judge's deadline, counted down in whole seconds on the synced clock. */
function TalkCountdown({
  until,
  capSec,
  now,
}: {
  until: number
  capSec: number
  now: () => number
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [until])
  // Same rule as the arm countdown: clamp to the most it can ever be, because
  // an unclamped one once read 1.7 trillion ms.
  const left = Math.min(capSec * 1000, Math.max(0, until - now()))
  return <span>{Math.ceil(left / 1000)}s</span>
}
```

- [ ] **Step 5: Style**

In `client/style.css`, beside the buzzer rules:

```css
/* The push-to-talk zone: the buzzer, re-purposed while the judge listens. */
.buzzer--talk.is-talking { border-color: var(--brass); }
.buzzer--talk.is-cancelling { border-color: var(--tally); color: var(--dim); }
```

(If `.buzzer` has no border by default, give the talk zone one: `.buzzer--talk { border: 2px solid var(--rule); }` — check the existing rule and keep the zone visually the same size as the buzzer so the swap does not shift the layout.)

- [ ] **Step 6: Build and verify by hand**

Run: `npm run build && npm run typecheck`
Expected: clean. The gesture loop itself is Task 11's checklist entry — it needs a real phone, a real mic, and a running pack.

- [ ] **Step 7: Commit**

```bash
git add client/Player.tsx client/style.css
git commit -m "judge: hold to answer — release sends, drag down cancels"
```

---

### Task 10: The board's spoken line

**Files:**
- Modify: `client/Board.tsx` (the `board__above` band ~line 272)
- Modify: `client/style.css`
- Modify: `docs/design.md`

**Interfaces:**
- Consumes: `round.spoken` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: The line**

In `client/Board.tsx`, at the top of `board__above`, before the award line:

```tsx
          {/* What was said, as the judge heard it — the award's evidence while
              the points are up, and the whole story while a rebound runs. */}
          {round.spoken && (
            <p class={round.spoken.hit ? 'board__spoken is-hit' : 'board__spoken is-miss'}>
              “{round.spoken.transcript || 'no answer'}”
            </p>
          )}
```

- [ ] **Step 2: Style**

In `client/style.css`, beside `.board__award`:

```css
/* The judge's transcript: brass when it scored, tally-red when it did not. */
.board__spoken {
  margin: 0 0 var(--s2);
  font-size: var(--t-lg);
  color: var(--dim);
}
.board__spoken.is-hit { color: var(--brass); }
.board__spoken.is-miss { color: var(--tally); }
```

- [ ] **Step 3: Document it**

In `docs/design.md` §5, beside the award/answer entries, add a short entry for `.board__spoken` in the same style: what it is, why it sits in `board__above` (the evidence belongs with the payoff, and the three-band layout keeps it from moving the hero), and why it survives a rebound while the window does not.

- [ ] **Step 4: Build and commit**

Run: `npm run build && npm run typecheck`
Expected: clean.

```bash
git add client/Board.tsx client/style.css docs/design.md
git commit -m "judge: the board shows what the room heard"
```

---

### Task 11: Probe, the checklist, and the docs

**Files:**
- Modify: `tools/probe.ts` (verb switch ~line 132; header comment)
- Modify: `docs/manual-checklist.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `POST /answer` text hook (Task 6), `round.judge` (Task 4).
- Produces: probe verb `speak:Name=transcript`.

- [ ] **Step 1: The verb**

In `tools/probe.ts`, in the verb switch beside `act`:

```ts
        // speak:Ada=green mountain state — the transcript POSTed as text/plain,
        // skipping STT, so a whole spoken round is one command. Quote the step:
        // npm run probe -- 'speak:Ada=green mountain state'
        case 'speak': {
          const [name, ...rest] = arg.split('=')
          const text = rest.join('=')
          if (!name || !text) throw new Error('speak needs Name=transcript')
          const conn = player(name)
          // Wait for the judge's window rather than assuming the lock: the
          // round must have locked with this player first and the judge primed.
          await host.waitFor(
            (s) =>
              s.round.phase === 'LOCKED' &&
              !!s.round.judge &&
              s.round.order[0]?.playerId === conn.playerId,
            10_000,
          )
          const res = await fetch(`${URL}/answer?player=${conn.playerId}`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: text,
          })
          log(`  → ${res.status}`)
          break
        }
```

Update the header comment's steps list (`speak` after `act`), and the usage line's step enumeration to include `speak`.

- [ ] **Step 2: Exercise it end to end**

With a pack on disk that has alternates (add one if needed — e.g. `packs/probe-spoken.txt` with `A: Vermont | VT | the Green Mountain State`; do not commit a throwaway pack, use an existing real pack if it has an `A:` line):

```bash
npm start          # one terminal
npm run probe -- join:Ada,Bo act:selectPack:<pack> act:read wait:4000 buzz:Ada@0 'speak:Ada=VT' wait:1500 clear
```

Expected: the window opens when Ada locks, `→ 200`, the board shows “VT” in brass, Ada scores the value, and the answer reveals. Then the miss path:

```bash
npm run probe -- join:Ada,Bo act:read wait:1000 buzz:Bo@0 'speak:Bo=new hampshire' wait:1500 clear
```

Expected: “new hampshire” in tally red, Bo docked the value, rebound re-arms.

(Probe drives the reader through `act:selectPack` / `act:read` — the same acts the host screen sends. The `wait:` numbers need to cover fragment speech; adjust to the pack.)

- [ ] **Step 3: The checklist**

In `docs/manual-checklist.md`, extend the `## Reading` section:

```markdown
### Spoken answers

- [ ] First boot with the judge: no `[stt]` warning; if a "Terminal wants
      Speech Recognition" dialog appeared, it was accepted once
- [ ] `npm run probe -- join:Ada,Bo act:selectPack:<pack> act:read wait:4000 buzz:Ada@0 'speak:Ada=<a real variant>'` — 200, transcript in brass on the board, points awarded
- [ ] Same with a wrong transcript — tally red, docked, rebound arms
- [ ] Real phone: join tap prompts for the mic once; lock in, hold to answer,
      release sends; the board shows what it heard within a second
- [ ] Drag down while holding cancels; nothing is sent, hold again to redo
- [ ] Answer window at 0: no countdown, and silence costs nothing until the
      host presses W
- [ ] Answer window at 5: say nothing — the lapse scores a wrong on its own
- [ ] Host W mid-answer: the judge's late verdict does not double-dock
- [ ] A machine mistake is one undo away: Z restores the pre-verdict state
```

- [ ] **Step 4: CLAUDE.md**

In `CLAUDE.md`:

- Architecture list, after the `server/reader.ts` bullet:

```markdown
- `server/judge.ts` — spoken answers while the reader drives. Opens a window
  when a round locks with a leader, transcribes via `server/stt/stt.swift`
  (swiftc-built at boot, on-device), fuzzy-matches against the pack's answer
  variants (`server/match.ts`), and returns the verdict through a synthetic
  host connection — undo and rebound apply unchanged. Primed answers live in
  memory only, never in State.
```

- The probe paragraph in "Verifying", after the duel sentence: `speak:Name=transcript` POSTs the transcript as `text/plain` into the judge's verdict path, so a whole spoken round is one command; real audio is the checklist's.

- [ ] **Step 5: Full green**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass, clean.

- [ ] **Step 6: Commit**

```bash
git add tools/probe.ts docs/manual-checklist.md CLAUDE.md
git commit -m "judge: probe speaks, and the checklist listens"
```

---

## Self-Review

**Spec coverage.** STT helper + build-on-boot + warm-up → Tasks 3 and 6. Pack alternates → Task 1. Matcher → Task 2. Judge with `transcribe` seam, reader prime, `round.judge` publish, POST validation, spoken-before-verdict ordering, lapse, race safety → Task 5 (state-machine sweeps in Task 4). `setAnswerWindow` + host input → Tasks 4 and 7. Phone: permission at join, buffered capture, gestures, 6s cap, WAV → Tasks 8 and 9. Board display → Task 10 (host display folded into Task 7). HTTP route with the `text/plain` hook → Task 6. Error handling: degradation (Tasks 3, 5, 6), garbage transcript = miss (Task 5 tests), non-leader/late POST = 409 (Task 5 tests), wrong-window POST after rebound = 409 (same validation). Testing plan: match/pack/state/judge tests, probe `speak:`, checklist — all present. Non-goals stay unbuilt.

**Placeholder scan.** Every code step carries the code. The two "verify by hand" steps (Tasks 9, 11) are phone-and-mic verification, which the spec assigns to the checklist — they name the exact commands.

**Type consistency.** `Transcribe`, `JudgeOpts`, `AnswerResult`, `Judge.prime/unprime/onStateChange/submit` keep their signatures from Task 5 into Task 6. `round.judge` is `{ until?: number }` in the type, the hub act, the judge, the phone and the probe. `round.spoken` is `{ name, transcript, hit }` everywhere. The probe waits on `s.round.judge` and `s.round.order[0]` — both host-view fields, and probe's host conn sees the unredacted order.

**One thing the executor should watch.** Task 5's full-loop test shares one hub between reader and judge through a single `setOnChange` fan-out; `index.ts` (Task 6) is the only other place that fan-out is composed, and it must call all three subscribers — the test harness fan-out in Task 5 is the template.
