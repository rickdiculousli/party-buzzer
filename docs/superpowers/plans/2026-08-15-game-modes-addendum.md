# Server-Side Reader and Phone Mirror — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the question loop out of `tools/read.ts` and into the server, driven from the host screen with pre-rendered speech, and let phones optionally mirror the board's question text.

**Architecture:** A `Reader` object lives beside the `Hub` and drives the game by sending the Hub the exact same `ClientMsg`s the CLI reader sent over a socket — through a synthetic host `Conn`. That is why the wire contract is unchanged and no new Hub API appears. Speech is pre-rendered to `.aiff` by `say -o`, cached by content hash, and played by `afplay`, which pause/resumes via `SIGSTOP`/`SIGCONT`. Question content lives in server memory only; `State` still receives nothing but spoken fragments.

**Tech Stack:** Node 26.7.0 native TypeScript (no build step), `node:test`, Preact, macOS `say`/`afplay`/`afinfo`.

**Spec:** `docs/superpowers/specs/2026-08-15-game-modes-addendum-design.md`

## Global Constraints

- **Node 26.7.0, pinned via mise.** Server code is native TypeScript — relative imports carry `.ts` extensions; `enum`, `namespace`, and constructor parameter properties are unavailable.
- **No CDN, no remote assets, anywhere.**
- **Runtime dependencies are exactly `ws` and `qrcode`.** Client is `preact`. Adding a runtime dependency is a decision, not a detail. This plan adds none.
- Tests use `node:test` and `node:assert/strict` only.
- Deliberate simplifications that cut a real corner carry a `ponytail:` comment naming the ceiling and the upgrade path.
- **`npm start` serves `dist/`.** A client change is invisible until `npm run build`.
- `node --test server/` (a bare directory) does not work on Node 26 — glob `'server/*.test.ts'`.
- Never restate a tuned value in a scenario; never inline a number into an anchor keyframe.

## File Structure

**Created:**
- `shared/pack.ts` — the pack parser, moved verbatim from `tools/pack.ts` (the server needs it now)
- `shared/pack.test.ts` — moved verbatim from `tools/pack.test.ts`
- `server/packs.ts` — enumerate `packs/*.txt`, load and parse one by name
- `server/speech.ts` — render to a cached clip, play it, pause/resume/stop. The only file that knows `say`, `afplay`, `afinfo` exist.
- `server/reader.ts` — the question loop
- `server/speech.test.ts`, `server/packs.test.ts`, `server/reader.test.ts`
- `packs/sample.txt` — moved from `tools/sample-pack.txt`

**Modified:**
- `shared/protocol.ts` — `State.packs`, `State.reading`, `State.mirrorFragments`, `setMirror` host action
- `server/state.ts` — the three new `newState` fields, `setMirror` in `applyHostAction`, `loadState` backfill
- `server/hub.ts` — `packs` refresh in the constructor, reader acts, `mirrorFragments` in `viewFor`
- `server/index.ts` — construct the `Reader`, fan `onChange` out to both `saveState` and the reader
- `client/Host.tsx` — pack picker and transport, progress line, and the `<details>` summary label fix (already dirty in the working tree)
- `client/Player.tsx` — render mirrored fragments
- `client/style.css` — one rule for the phone's question text
- `package.json` — drop the `read` script

**Deleted:**
- `tools/read.ts`, `tools/pack.ts`, `tools/pack.test.ts`, `tools/sample-pack.txt`

---

### Task 1: Move the pack parser into `shared/`, retire the CLI reader

The parser is pure and the server needs it. Nothing about it changes except its
home and one stale comment. The CLI reader goes in the same commit because it is
the only consumer being removed, and `probe`'s `act:` steps already cover the
debugging it was used for.

**Files:**
- Create: `shared/pack.ts` (from `tools/pack.ts`)
- Create: `shared/pack.test.ts` (from `tools/pack.test.ts`)
- Create: `packs/sample.txt` (from `tools/sample-pack.txt`)
- Delete: `tools/pack.ts`, `tools/pack.test.ts`, `tools/read.ts`, `tools/sample-pack.txt`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `parsePack(text: string): PackResult`, `type Question = { value?: number; fragments: string[]; answer: string }`, `type PackResult = { questions: Question[]; errors: string[] }` — all from `shared/pack.ts`, unchanged signatures.

- [ ] **Step 1: Move the files with git so history follows**

```bash
mkdir -p packs
git mv tools/pack.ts shared/pack.ts
git mv tools/pack.test.ts shared/pack.test.ts
git mv tools/sample-pack.txt packs/sample.txt
git rm tools/read.ts
```

- [ ] **Step 2: Fix the import in the moved test**

In `shared/pack.test.ts`, the import is `from './pack.ts'` already — it moved
alongside its subject, so the relative path still resolves. Confirm with:

Run: `grep -n "from '" shared/pack.test.ts`
Expected: `import { parsePack } from './pack.ts'` and the `node:test` /
`node:assert/strict` imports. If any path points at `../tools/`, correct it to
`./pack.ts`.

- [ ] **Step 3: Correct the stale header comment in `shared/pack.ts`**

The old comment claims the reader tool owns the pack. Replace the last paragraph
of the block comment (currently "The reader tool owns the pack; question content
never touches the server beyond the fragments it reveals.") with:

```ts
 * The server owns the pack and holds it in memory. Question content never
 * reaches `State` — only the fragments the room has already heard do, which is
 * what keeps a phone from seeing ahead.
```

- [ ] **Step 4: Drop the `read` script**

In `package.json`, delete the `"read"` line from `scripts`. Leave `sim`, `probe`,
`motion`, and `fakes` alone.

Run: `grep -n '"read"' package.json`
Expected: no output.

- [ ] **Step 5: Run the moved tests**

Run: `node --test shared/pack.test.ts`
Expected: PASS, same four cases as before the move.

- [ ] **Step 6: Typecheck catches any dangling import of the old paths**

Run: `npm run typecheck`
Expected: clean. If it names `tools/read.ts`, the delete did not land.

- [ ] **Step 7: Commit**

```bash
git add -A shared/pack.ts shared/pack.test.ts packs/sample.txt package.json tools/
git commit -m "refactor: the pack parser moves to shared/, the CLI reader retires"
```

---

### Task 2: State fields for packs, reading progress, and the mirror

Three additions, all inside `State`, so they ride the existing snapshot, undo and
broadcast paths exactly like `games` and `items` do.

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `server/state.ts:12-33` (`newState`), `applyHostAction`, `loadState`
- Test: `server/state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `State.packs: string[]` — pack filenames, refreshed at startup like `games`
  - `State.mirrorFragments: boolean` — whether players see `round.fragments`
  - `State.reading?: ReadingState` where
    `type ReadingState = { pack: string; qIndex: number; qTotal: number; fragIndex: number; fragTotal: number; paused: boolean; rendering?: { done: number; total: number } }`
  - `HostAction` gains `{ a: 'setMirror'; on: boolean }`

- [ ] **Step 1: Write the failing test**

Append to `server/state.test.ts`:

```ts
test('setMirror flips the phone mirror and defaults off', () => {
  const state = newState()
  assert.equal(state.mirrorFragments, false)
  applyHostAction(state, { a: 'setMirror', on: true })
  assert.equal(state.mirrorFragments, true)
})

test('loadState backfills the addendum fields on an older snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pb-'))
  const path = join(dir, 'state.json')
  const old = newState() as Record<string, unknown>
  delete old.packs
  delete old.mirrorFragments
  writeFileSync(path, JSON.stringify(old))
  const loaded = loadState(path)
  assert.deepEqual(loaded.packs, [])
  assert.equal(loaded.mirrorFragments, false)
  assert.equal(loaded.reading, undefined)
})
```

Check the top of `server/state.test.ts` for the imports it already has. If
`mkdtempSync`, `writeFileSync`, `tmpdir`, or `join` are missing, add:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test server/state.test.ts`
Expected: FAIL — `setMirror` is not a valid `HostAction`, and `packs` is
`undefined` rather than `[]`.

- [ ] **Step 3: Add the types to `shared/protocol.ts`**

Add above `export type State`:

```ts
/**
 * What the reader is doing, for the host screen alone. Display-only: the reader
 * owns playback and republishes from its own loop, so an undo that restores a
 * stale block corrects itself on the next push rather than rewinding the audio.
 */
export type ReadingState = {
  pack: string
  qIndex: number
  qTotal: number
  fragIndex: number
  fragTotal: number
  paused: boolean
  /** Present only while a freshly selected pack is being synthesised. */
  rendering?: { done: number; total: number }
}
```

Add these three fields inside `State`:

```ts
  /** Pack filenames on disk. Filenames only — question content never enters State. */
  packs: string[]
  /** Whether players see round.fragments. Off for quizbowl: reading a whole
   *  sentence at its start beats hearing it word by word. */
  mirrorFragments: boolean
  reading?: ReadingState
```

Add to the `HostAction` union:

```ts
  | { a: 'setMirror'; on: boolean }
```

- [ ] **Step 4: Add the fields to `newState()` in `server/state.ts`**

Inside the returned object, beside `games: []`:

```ts
    packs: [],
    mirrorFragments: false,
```

Do not add `reading` — it is optional and absent until a pack is selected.

- [ ] **Step 5: Handle `setMirror` in `applyHostAction`**

Add a case alongside the other simple setters (near `setMode`):

```ts
    case 'setMirror':
      state.mirrorFragments = action.on
      return
```

- [ ] **Step 6: Backfill in `loadState`**

Find where `loadState` already backfills `items`, `effects`, and `games` for
older snapshots and add the same treatment:

```ts
  if (!Array.isArray(state.packs)) state.packs = []
  if (typeof state.mirrorFragments !== 'boolean') state.mirrorFragments = false
```

Leave `reading` alone — a stale one is cleared by the reader on its next push,
and an absent one is the correct resting state.

- [ ] **Step 7: Run the tests**

Run: `node --test server/state.test.ts`
Expected: PASS, including the existing migration tests.

- [ ] **Step 8: Commit**

```bash
git add shared/protocol.ts server/state.ts server/state.test.ts
git commit -m "feat: state carries the pack list, reading progress, and the mirror flag"
```

---

### Task 3: Enumerate and load packs

Small and pure enough to test against a temp directory. Filenames only ever leave
this module as strings; parsed questions stay in the caller's memory.

**Files:**
- Create: `server/packs.ts`
- Test: `server/packs.test.ts`

**Interfaces:**
- Consumes: `parsePack`, `Question` from `shared/pack.ts` (Task 1).
- Produces:
  - `listPacks(dir: string): string[]` — sorted `*.txt` basenames, `[]` if the directory is missing
  - `loadPack(dir: string, name: string): { questions: Question[]; errors: string[] }` — throws `Error` if the name escapes the directory or the file is missing

- [ ] **Step 1: Write the failing test**

Create `server/packs.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listPacks, loadPack } from './packs.ts'

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pb-packs-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

test('listPacks returns sorted .txt basenames and ignores everything else', () => {
  const dir = dirWith({
    'zulu.txt': 'Q. / R.\nA: a',
    'alpha.txt': 'Q. / R.\nA: a',
    'notes.md': 'ignore me',
  })
  mkdirSync(join(dir, '.cache'))
  assert.deepEqual(listPacks(dir), ['alpha.txt', 'zulu.txt'])
})

test('listPacks on a missing directory is empty, not an error', () => {
  assert.deepEqual(listPacks(join(tmpdir(), 'pb-does-not-exist-'+ Date.now())), [])
})

test('loadPack parses the named file', () => {
  const dir = dirWith({ 'one.txt': 'V: 300\nFirst. / Second.\nA: gold' })
  const { questions, errors } = loadPack(dir, 'one.txt')
  assert.deepEqual(errors, [])
  assert.equal(questions.length, 1)
  assert.equal(questions[0].value, 300)
  assert.deepEqual(questions[0].fragments, ['First.', 'Second.'])
  assert.equal(questions[0].answer, 'gold')
})

test('loadPack refuses a name that escapes the pack directory', () => {
  const dir = dirWith({ 'one.txt': 'First.\nA: a' })
  assert.throws(() => loadPack(dir, '../../etc/passwd'), /outside the pack directory/)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test server/packs.test.ts`
Expected: FAIL — cannot find module `./packs.ts`.

- [ ] **Step 3: Implement `server/packs.ts`**

```ts
/**
 * Packs on disk. The server holds question content in memory while reading and
 * never puts it in `State` — only spoken fragments go there.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parsePack, type Question } from '../shared/pack.ts'

/** Sorted pack filenames. A missing directory is a room with no packs, not an error. */
export function listPacks(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort()
  } catch {
    return []
  }
}

export function loadPack(dir: string, name: string): { questions: Question[]; errors: string[] } {
  // The name arrives from a host message, so it is untrusted input naming a
  // path. A name that is not already its own basename is trying to traverse.
  if (name !== basename(name)) {
    throw new Error(`pack "${name}" resolves outside the pack directory`)
  }
  return parsePack(readFileSync(join(dir, name), 'utf8'))
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test server/packs.test.ts`
Expected: PASS, all four.

- [ ] **Step 5: Commit**

```bash
git add server/packs.ts server/packs.test.ts
git commit -m "feat: enumerate and load question packs from disk"
```

---

### Task 4: Speech — render to a cached clip, play it, pause it

The only file that knows the macOS binaries exist. Isolating it is what lets the
reader loop be tested without making a sound.

Verified behaviour this task depends on: `say -o out.aiff "text"` renders at
roughly realtime and parallelises; `afinfo` prints `estimated duration: N sec`;
`afplay` under `SIGSTOP`/`SIGCONT` resumes sample-accurately (paused 1.0s into a
4.85s clip left 3.81s to play).

**Files:**
- Create: `server/speech.ts`
- Test: `server/speech.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `clipPath(cacheDir: string, text: string, voice?: string): string` — the cache path for this text and voice
  - `render(cacheDir: string, text: string, voice?: string): Promise<Clip>` where `type Clip = { path: string; durationMs: number }`
  - `play(path: string): Playback` where `type Playback = { done: Promise<void>; pause(): void; resume(): void; stop(): void }`
  - `parseDuration(afinfoOutput: string): number` — ms, `0` when absent
  - `type Speech = { render: typeof render; play: typeof play }` — the shape `Reader` takes so tests can substitute one

- [ ] **Step 1: Write the failing test**

Only the pure parts get unit tests — the cache key and the `afinfo` parse.
Playback is two signals and a child process; Task 5 tests the loop around it with
this module stubbed.

Create `server/speech.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { clipPath, parseDuration } from './speech.ts'

test('the cache key follows the text and the voice', () => {
  const a = clipPath('/tmp/c', 'Which element has atomic number 79?')
  const b = clipPath('/tmp/c', 'Which element has atomic number 79?')
  const c = clipPath('/tmp/c', 'A different sentence entirely.')
  const d = clipPath('/tmp/c', 'Which element has atomic number 79?', 'Fred')
  assert.equal(a, b, 'same text and voice must hit the same clip')
  assert.notEqual(a, c, 'different text must miss')
  assert.notEqual(a, d, 'different voice must miss')
  assert.match(a, /\.aiff$/)
})

test('parseDuration reads afinfo, and survives output without one', () => {
  const out = [
    'File:           frag.aiff',
    'File type ID:   AIFC',
    'estimated duration: 4.847982 sec',
    'audio bytes: 213796',
  ].join('\n')
  assert.equal(parseDuration(out), 4848)
  assert.equal(parseDuration('no duration here'), 0)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test server/speech.test.ts`
Expected: FAIL — cannot find module `./speech.ts`.

- [ ] **Step 3: Implement `server/speech.ts`**

```ts
/**
 * Speech, pre-rendered. `say` synthesises at roughly realtime, so doing it live
 * would put a pause before every sentence; rendering the whole pack up front
 * turns playback into a file we control. That is also what makes pause real —
 * `afplay` under SIGSTOP resumes exactly where it stopped.
 *
 * Clips cache by a hash of the text and the voice, so a pack read twice renders
 * once, ever.
 *
 * macOS only. Without these binaries every call degrades to silence and the
 * game still runs — fragments appear, power still closes.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Clip = { path: string; durationMs: number }
export type Playback = {
  done: Promise<void>
  pause(): void
  resume(): void
  stop(): void
}
export type Speech = {
  render(cacheDir: string, text: string, voice?: string): Promise<Clip>
  play(path: string): Playback
}

export function clipPath(cacheDir: string, text: string, voice?: string): string {
  const hash = createHash('sha256').update(`${voice ?? 'default'}\n${text}`).digest('hex')
  return join(cacheDir, `${hash.slice(0, 16)}.aiff`)
}

/** `afinfo` prints `estimated duration: 4.847982 sec`. Milliseconds, 0 if absent. */
export function parseDuration(afinfoOutput: string): number {
  const m = /estimated duration:\s*([\d.]+)\s*sec/.exec(afinfoOutput)
  return m ? Math.round(Number(m[1]) * 1000) : 0
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    const p = spawn(cmd, args)
    p.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    p.on('close', (code) => resolve({ ok: code === 0, stdout }))
    p.on('error', () => resolve({ ok: false, stdout: '' }))
  })
}

export async function render(cacheDir: string, text: string, voice?: string): Promise<Clip> {
  mkdirSync(cacheDir, { recursive: true })
  const path = clipPath(cacheDir, text, voice)
  if (!existsSync(path)) {
    const args = voice ? ['-v', voice, '-o', path, text] : ['-o', path, text]
    const { ok } = await run('say', args)
    // No `say` on this box, or one bad fragment. Duration 0 means "play nothing
    // and move on" — the fragment still goes up on the board.
    if (!ok) return { path, durationMs: 0 }
  }
  const { stdout } = await run('afinfo', [path])
  return { path, durationMs: parseDuration(stdout) }
}

export function play(path: string): Playback {
  const p = spawn('afplay', [path])
  const done = new Promise<void>((resolve) => {
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
  const signal = (sig: NodeJS.Signals) => {
    try {
      p.kill(sig)
    } catch {
      // Already gone. Nothing to hold or release.
    }
  }
  return {
    done,
    pause: () => signal('SIGSTOP'),
    // SIGCONT on a stopped afplay resumes sample-accurately; there is no seek
    // and none is needed.
    resume: () => signal('SIGCONT'),
    stop: () => {
      // A stopped process ignores SIGKILL until it is continued.
      signal('SIGCONT')
      signal('SIGKILL')
    },
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test server/speech.test.ts`
Expected: PASS, both.

- [ ] **Step 5: Confirm the real binaries behave as assumed**

This is a one-off sanity check, not a committed test. On a macOS box:

```bash
node --input-type=module -e "
import { render, play } from './server/speech.ts'
const clip = await render('/tmp/pb-cache', 'Testing the pre-rendered reader.')
console.log('duration', clip.durationMs, 'ms')
const pb = play(clip.path)
setTimeout(() => { pb.pause(); console.log('paused') }, 600)
setTimeout(() => { pb.resume(); console.log('resumed') }, 1600)
await pb.done
console.log('finished')
"
```

Expected: a non-zero duration, audible speech that holds for a second mid-word
and continues from the same word, then `finished`.

- [ ] **Step 6: Commit**

```bash
git add server/speech.ts server/speech.test.ts
git commit -m "feat: pre-rendered speech, cached by content, pausable with SIGSTOP"
```

---

### Task 5: The reader loop

The heart of the change. It drives the Hub by sending the same `ClientMsg`s the
CLI reader sent over a socket, through a synthetic host `Conn` — so every
existing validation, broadcast and undo path applies unchanged, and no new Hub
method is needed.

**Files:**
- Create: `server/reader.ts`
- Test: `server/reader.test.ts`

**Interfaces:**
- Consumes: `Hub`, `Conn` from `server/hub.ts`; `listPacks`, `loadPack` from `server/packs.ts`; `Speech`, `Clip`, `Playback` from `server/speech.ts`; `Question` from `shared/pack.ts`.
- Produces:
  - `class Reader` with constructor `(hub: Hub, opts: ReaderOpts)` where
    `type ReaderOpts = { packDir: string; cacheDir: string; speech?: Speech; voice?: string }`
  - `reader.select(name: string): Promise<void>` — load, render every fragment, publish progress
  - `reader.start(): void` — begin the question loop from the current position
  - `reader.pause(): void`, `reader.resume(): void`, `reader.stop(): void`
  - `reader.onStateChange(state: State): void` — called by the Hub's `onChange`; wakes anything waiting on a condition

- [ ] **Step 1: Write the failing test**

Create `server/reader.test.ts`. The speech module is stubbed, so this makes no
sound and runs at full speed.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub } from './hub.ts'
import { newState } from './state.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'

/** Speech that plays instantly and records what it was asked to say. */
function fakeSpeech(): Speech & { spoken: string[] } {
  const spoken: string[] = []
  return {
    spoken,
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: (path) => {
      spoken.push(path.replace('/fake/', ''))
      return {
        done: Promise.resolve(),
        pause: () => {},
        resume: () => {},
        stop: () => {},
      }
    },
  }
}

function rig(packBody: string) {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-'))
  writeFileSync(join(packDir, 'one.txt'), packBody)
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: join(packDir, '.cache'),
    speech,
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  return { hub, state, reader, speech }
}

const PACK = 'V: 300\nFirst fragment. / Second fragment.\nA: gold\n'

test('selecting a pack renders every fragment and publishes progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  assert.equal(state.reading?.pack, 'one.txt')
  assert.equal(state.reading?.qTotal, 1)
  assert.equal(state.reading?.rendering, undefined, 'rendering clears when done')
})

test('reading a question arms it, speaks each fragment, and pushes them in order', async () => {
  const { state, reader, speech } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  await reader.settled()

  assert.equal(state.round.value, 300, 'the pack value drives the round')
  assert.deepEqual(speech.spoken, ['First fragment.', 'Second fragment.'])
  assert.deepEqual(state.round.fragments, ['First fragment.', 'Second fragment.'])
})

test('power closes after the configured fragment', async () => {
  const { hub, state, reader } = rig(PACK)
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: { a: 'setGame', id: 'quizbowl', options: { powerAfterFragment: 1 } },
  })
  await reader.select('one.txt')
  reader.start()
  await reader.settled()

  const ms = state.game.moduleState as { powerEndsAt?: number }
  assert.ok(ms.powerEndsAt, 'powerEnds fired at the fragment boundary')
})

test('an undo mid-question aborts the reader instead of pushing onto a dead round', async () => {
  const { hub, state, reader, speech } = rig(
    'One. / Two. / Three.\nA: a\n',
  )
  await reader.select('one.txt')
  reader.start()
  // Re-arm under the reader's feet: a new arm stamp means a different round.
  await new Promise((r) => setTimeout(r, 5))
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'arm' } })
  await reader.settled()

  assert.ok(
    speech.spoken.length < 3,
    `expected the reader to abort, but it spoke all of ${speech.spoken.length}`,
  )
})

test('stop halts the loop and clears reading progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  reader.stop()
  await reader.settled()
  assert.equal(state.reading, undefined)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test server/reader.test.ts`
Expected: FAIL — cannot find module `./reader.ts`, and `hub.setOnChange` does not
exist yet.

- [ ] **Step 3: Add `setOnChange` to `server/hub.ts`**

The Hub takes `onChange` in its constructor today, but `index.ts` must now fan it
out to both the snapshot and the reader, and the reader is built after the Hub.
One setter, beside `add`/`remove`:

```ts
  /** Replace the change subscriber. The reader is built after the hub, so the
   *  composition root swaps in a fan-out once both exist. */
  setOnChange(fn: (state: State) => void): void {
    this.onChange = fn
  }
```

- [ ] **Step 4: Implement `server/reader.ts`**

```ts
/**
 * The reader: speaks a question pack aloud, fragment by fragment, and drives the
 * game in time with its own voice.
 *
 * It drives the hub by sending the same `ClientMsg`s the old CLI reader sent
 * over a socket, through a synthetic host connection. That is deliberate: every
 * validation, broadcast and undo path applies unchanged, the module still cannot
 * tell who drove it, and the hub grows no reader-shaped API.
 *
 * The human host still judges. C and W on the host screen score the round as
 * always — a wrong answer re-arms for a rebound and the reader waits it out.
 *
 * Pause holds the audio and nothing else: buzzers stay live and `powerEndsAt` is
 * untouched, because the reason to pause is usually that someone interrupted,
 * and that is exactly when a buzz should still land. The power boundary stays
 * event-driven for the same reason — scheduling it from a known clip duration
 * would desynchronise the moment anyone paused.
 */
import { join } from 'node:path'
import type { Hub, Conn } from './hub.ts'
import { loadPack } from './packs.ts'
import { render as realRender, play as realPlay, type Playback, type Speech } from './speech.ts'
import type { Question } from '../shared/pack.ts'
import type { State } from '../shared/protocol.ts'

export type ReaderOpts = {
  packDir: string
  cacheDir: string
  speech?: Speech
  voice?: string
}

export class Reader {
  private hub: Hub
  private opts: ReaderOpts
  private speech: Speech
  private conn: Conn
  private questions: Question[] = []
  private clips = new Map<string, string>()
  private pack = ''
  private qIndex = 0
  private fragIndex = 0
  private paused = false
  private playback: Playback | undefined
  private loop: Promise<void> = Promise.resolve()
  private running = false
  private waiters = new Set<() => void>()

  constructor(hub: Hub, opts: ReaderOpts) {
    this.hub = hub
    this.opts = opts
    this.speech = opts.speech ?? { render: realRender, play: realPlay }
    this.conn = { id: 'reader', role: 'host', send: () => {} }
  }

  /** Called from the hub's onChange. Wakes anything waiting on a condition. */
  onStateChange(_state: State): void {
    for (const w of [...this.waiters]) w()
  }

  /** Resolves when the current loop has finished — the test seam for the loop. */
  settled(): Promise<void> {
    return this.loop
  }

  async select(name: string): Promise<void> {
    this.stop()
    const { questions } = loadPack(this.opts.packDir, name)
    this.questions = questions
    this.pack = name
    this.qIndex = 0
    this.fragIndex = 0
    this.clips.clear()

    const texts = questions.flatMap((q) => q.fragments)
    this.publish({ rendering: { done: 0, total: texts.length } })

    // ponytail: renders four at a time. Serial is too slow for a long pack and
    // unbounded floods the box; a queue with real backpressure if it matters.
    let done = 0
    const queue = [...texts]
    const worker = async () => {
      for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
        const clip = await this.speech.render(this.opts.cacheDir, text, this.opts.voice)
        this.clips.set(text, clip.path)
        done += 1
        this.publish({ rendering: { done, total: texts.length } })
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    this.publish({ rendering: undefined })
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loop = this.run().finally(() => {
      this.running = false
    })
  }

  pause(): void {
    this.paused = true
    this.playback?.pause()
    this.publish({})
  }

  resume(): void {
    this.paused = false
    this.playback?.resume()
    this.publish({})
  }

  stop(): void {
    this.running = false
    this.paused = false
    this.playback?.stop()
    this.playback = undefined
    this.hub.state.reading = undefined
    this.wake()
  }

  private wake(): void {
    for (const w of [...this.waiters]) w()
  }

  /** Push the current position into State, for the host screen only. */
  private publish(patch: { rendering?: { done: number; total: number } | undefined }): void {
    const q = this.questions[this.qIndex]
    const reading = {
      pack: this.pack,
      qIndex: this.qIndex,
      qTotal: this.questions.length,
      fragIndex: this.fragIndex,
      fragTotal: q?.fragments.length ?? 0,
      paused: this.paused,
      rendering: 'rendering' in patch ? patch.rendering : this.hub.state.reading?.rendering,
    }
    this.hub.send(this.conn, { t: 'act', act: 'reading', data: reading })
  }

  private async run(): Promise<void> {
    for (; this.qIndex < this.questions.length && this.running; this.qIndex++) {
      const q = this.questions[this.qIndex]
      this.fragIndex = 0
      if (q.value !== undefined) {
        this.hub.send(this.conn, { t: 'host', action: { a: 'setValue', value: q.value } })
      }
      this.hub.send(this.conn, { t: 'host', action: { a: 'arm' } })
      await this.until((s) => s.round.phase === 'ARMED')
      if (!this.running) return

      // The arm this question belongs to. If it changes under us — an undo, a
      // host re-arm — this question is over and pushing onto it would land on a
      // round that no longer exists.
      const stamp = this.hub.state.round.armedAt
      await sleep(Math.max(0, stamp - Date.now()))

      const powerAfter = Number(this.hub.state.game.options.powerAfterFragment ?? 0)
      for (let f = 0; f < q.fragments.length && this.running; f++) {
        if (this.hub.state.round.armedAt !== stamp) return
        this.fragIndex = f + 1
        const text = q.fragments[f]
        this.hub.send(this.conn, { t: 'act', act: 'fragment', data: text })
        this.publish({})
        await this.speak(text)
        if (!this.running || this.hub.state.round.armedAt !== stamp) return
        if (powerAfter > 0 && f + 1 === powerAfter) {
          this.hub.send(this.conn, { t: 'act', act: 'powerEnds' })
        }
      }

      // The host judges from here. Resolved means scored, or passed with nobody
      // left in the round.
      await this.until(
        (s) =>
          s.round.phase === 'IDLE' &&
          (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0)),
      )
      if (!this.running) return
      if (this.hub.state.round.award) {
        this.hub.send(this.conn, { t: 'act', act: 'revealAnswer', data: q.answer })
      }
      // Let the payoff sit on the wall; the host's N clears it and releases us.
      await this.until((s) => s.round.phase === 'IDLE' && !s.round.award)
    }
    this.stop()
  }

  private async speak(text: string): Promise<void> {
    const path = this.clips.get(text)
    if (!path) return
    const pb = this.speech.play(path)
    this.playback = pb
    if (this.paused) pb.pause()
    await pb.done
    this.playback = undefined
  }

  /** Wait until the state satisfies a predicate, or the reader stops. */
  private until(ok: (s: State) => boolean): Promise<void> {
    if (!this.running || ok(this.hub.state)) return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (this.running && !ok(this.hub.state)) return
        this.waiters.delete(check)
        resolve()
      }
      this.waiters.add(check)
    })
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
```

- [ ] **Step 5: Add `Hub.send` — the synthetic-connection entry point**

`Reader` calls `hub.send(conn, msg)`. That is `handle` under a name that reads
right from the outside; add it to `server/hub.ts` beside `handle`:

```ts
  /** Deliver a message as if it arrived on a connection. The reader drives the
   *  game this way, so it goes through every check a real host does. */
  send(conn: Conn, msg: ClientMsg): void {
    this.handle(conn, msg)
  }
```

- [ ] **Step 6: Run the tests**

Run: `node --test server/reader.test.ts`
Expected: FAIL on the `reading` act — the hub drops it as unknown, so
`state.reading` is never set. Task 6 adds it. Confirm the failure names
`reading`, then continue.

- [ ] **Step 7: Commit the work in progress**

```bash
git add server/reader.ts server/reader.test.ts server/hub.ts
git commit -m "feat: the reader loop, driving the hub through a synthetic host conn"
```

---

### Task 6: Hub wiring — the reading act, the pack list, and the mirror

Three small changes in `server/hub.ts`, which together make Task 5's tests pass.

**Files:**
- Modify: `server/hub.ts` — constructor, `act`, `viewFor`
- Test: `server/hub.test.ts`

**Interfaces:**
- Consumes: `listPacks` from `server/packs.ts`; `ReadingState` from `shared/protocol.ts`.
- Produces: `HubOpts` gains `packDir?: string`. The `reading` act is host-scoped.

- [ ] **Step 1: Write the failing test**

Append to `server/hub.test.ts`:

```ts
test('players see mirrored fragments only when the mirror is on', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  hub.handle(phone, { t: 'hello', role: 'player', name: 'Ada' })
  state.round.fragments = ['First fragment.']
  state.round.answer = 'gold'

  const off = hub.viewFor(phone)
  assert.equal(off.round.fragments, undefined, 'off: the phone sees nothing')
  assert.equal(off.round.answer, undefined)

  state.mirrorFragments = true
  const on = hub.viewFor(phone)
  assert.deepEqual(on.round.fragments, ['First fragment.'], 'on: the phone mirrors the board')
  assert.equal(on.round.answer, 'gold')
})

test('the mirror never widens the buzz-order redaction', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  hub.handle(a, { t: 'hello', role: 'player', name: 'Ada' })
  hub.handle(b, { t: 'hello', role: 'player', name: 'Bo' })
  state.mirrorFragments = true
  state.round.order = [
    { playerId: a.playerId!, name: 'Ada', at: 1, delta: 0 },
    { playerId: b.playerId!, name: 'Bo', at: 2, delta: 1 },
  ]
  assert.equal(hub.viewFor(a).round.order.length, 1, 'still only your own buzz')
})

test('the reading act is host-scoped and lands in state', () => {
  const { hub, conn, lastState } = rig()
  const host = conn('host')
  const phone = conn('player')
  const reading = {
    pack: 'one.txt', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 2, paused: false,
  }
  hub.handle(phone, { t: 'act', act: 'reading', data: { ...reading, pack: 'forged.txt' } })
  assert.equal(hub.state.reading, undefined, 'a phone cannot fake reading progress')
  hub.handle(host, { t: 'act', act: 'reading', data: reading })
  assert.equal(lastState(0).reading?.pack, 'one.txt')
})
```

If `BuzzEntry` needs different fields than `{ playerId, name, at, delta }`, copy
the shape used by the existing order tests in this file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test server/hub.test.ts`
Expected: FAIL — the mirror is ignored and `reading` is an unknown act.

- [ ] **Step 3: Refresh the pack list in the constructor**

Add the import at the top of `server/hub.ts`:

```ts
import { listPacks } from './packs.ts'
```

Add `packDir?: string` to `HubOpts`, then in the constructor beside the catalog
refresh:

```ts
    // Filenames only, refreshed on boot for the same reason the catalog is: a
    // snapshot's copy is from whenever it was written.
    this.state.packs = opts.packDir ? listPacks(opts.packDir) : []
```

- [ ] **Step 4: Handle the `reading` act**

In `act`, in the host-scoped chain beside `fragment` and `revealAnswer`:

```ts
    } else if (name === 'reading') {
      // Display-only progress from the reader. Undefined clears it.
      this.state.reading = (data ?? undefined) as State['reading']
    } else if (
```

- [ ] **Step 5: Honour the mirror in `viewFor`**

In the player branch, replace the two unconditional strips:

```ts
        fragments: this.state.mirrorFragments ? round.fragments : undefined,
        answer: this.state.mirrorFragments ? round.answer : undefined,
```

Update the method's doc comment — it currently states flatly that question text
is stripped:

```ts
   * Phones get the round redacted to their own buzz, module state only through
   * the module's own viewModuleState, and question text stripped unless the
   * room has turned the mirror on — quizbowl leaves it off, because reading a
   * sentence at its start beats hearing it word by word.
```

- [ ] **Step 6: Run both suites**

Run: `node --test server/hub.test.ts server/reader.test.ts`
Expected: PASS. Task 5's reader tests now pass too — that is the point of this
task's ordering.

- [ ] **Step 7: Commit**

```bash
git add server/hub.ts server/hub.test.ts
git commit -m "feat: reading progress, the pack list, and the mirror in the hub"
```

---

### Task 7: Compose the reader in the server, and expose its controls

Wire the `Reader` into `startServer` and route the host's transport acts to it.

**Files:**
- Modify: `server/index.ts:59-74`
- Modify: `server/hub.ts` — route reader acts

**Interfaces:**
- Consumes: `Reader` from `server/reader.ts`.
- Produces: `HubOpts` gains `reader?: ReaderControls` where
  `type ReaderControls = { select(name: string): Promise<void>; start(): void; pause(): void; resume(): void; stop(): void }`.
  Host acts `selectPack` (data: filename), `read`, `pauseRead`, `resumeRead`, `stopRead`.

- [ ] **Step 1: Add the control acts to the hub**

Playback control is not undoable game state, so it rides the `act` channel rather
than `HostAction` — undoing a pause is meaningless.

In `server/hub.ts`, add the type and the option:

```ts
export type ReaderControls = {
  select(name: string): Promise<void>
  start(): void
  pause(): void
  resume(): void
  stop(): void
}
```

Add `reader?: ReaderControls` to `HubOpts`, store it as
`private reader: ReaderControls | undefined` and assign it in the constructor.
Because the reader is built after the hub, also add a setter beside
`setOnChange`:

```ts
  setReader(reader: ReaderControls): void {
    this.reader = reader
  }
```

In `act`, inside the host-scoped chain:

```ts
    } else if (name === 'selectPack' && typeof data === 'string') {
      // Mid-question would cut the room off; refuse it the way setGame does.
      if (this.state.round.phase !== 'IDLE') return
      void this.reader?.select(data)
    } else if (name === 'read') {
      this.reader?.start()
    } else if (name === 'pauseRead') {
      this.reader?.pause()
    } else if (name === 'resumeRead') {
      this.reader?.resume()
    } else if (name === 'stopRead') {
      this.reader?.stop()
    } else if (
```

- [ ] **Step 2: Compose in `server/index.ts`**

Add the imports:

```ts
import { Reader } from './reader.ts'
```

Replace the hub construction block (currently `server/index.ts:68-73`) with:

```ts
  const packDir = opts.packDir ?? join(ROOT, 'packs')
  const state = loadState(statePath)
  const hub = new Hub(state, {
    revealMs: opts.revealMs,
    collectMs: opts.collectMs,
    packDir,
    onChange: (s) => saveState(statePath, s),
  })

  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache') })
  hub.setReader(reader)
  // Both subscribers, now that both exist: the snapshot and the reader's waits.
  hub.setOnChange((s) => {
    saveState(statePath, s)
    reader.onStateChange(s)
  })
```

Add `packDir?: string` to the `startServer` options type.

- [ ] **Step 3: Ignore the clip cache in git**

Append to `.gitignore`:

```
packs/.cache/
```

- [ ] **Step 4: Verify the whole suite and the types**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 5: Verify by hand that a pack actually reads**

```bash
npm run build && npm start
```

Then in another shell:

```bash
node --input-type=module -e "
import WebSocket from 'ws'
const ws = new WebSocket('ws://127.0.0.1:8080/ws')
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', role: 'host' }))
  setTimeout(() => ws.send(JSON.stringify({ t: 'act', act: 'selectPack', data: 'sample.txt' })), 200)
  setTimeout(() => ws.send(JSON.stringify({ t: 'act', act: 'read' })), 4000)
})
ws.on('message', (m) => {
  const d = JSON.parse(m)
  if (d.t === 'state' && d.state.reading) console.log(JSON.stringify(d.state.reading))
})
"
```

Expected: `rendering` counts up, then clears; the box speaks the first fragment;
`fragIndex` advances. Ctrl-C when satisfied, and `npm run probe -- clear` to put
the room back.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/hub.ts .gitignore
git commit -m "feat: the server owns the reader, driven by host transport acts"
```

---

### Task 8: Host screen — pack picker, transport, progress

Picking the question set is game night, not setup, so these go with the play
controls rather than inside the `<details>`. The dirty `client/Host.tsx` summary
label fix rides along here — the mode dropdown stays in the `<details>`, so
naming it in the summary is still right.

**Files:**
- Modify: `client/Host.tsx` (already dirty — keep that edit)
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `State.packs`, `State.reading`, `State.mirrorFragments` (Task 2); acts `selectPack`, `read`, `pauseRead`, `resumeRead`, `stopRead` (Task 7).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Give `Host` an act sender**

`Host` currently only sends `HostAction`s. Beside `const act = …` near
`client/Host.tsx:21`:

```ts
  const fire = (a: string, data?: unknown) => send({ t: 'act', act: a, data })
```

- [ ] **Step 2: Add the reader row under the existing controls**

Insert directly after the `host__minor` div (which closes at
`client/Host.tsx:142`), still inside that `<section>`:

```tsx
        {state.packs.length > 0 && (
          <div class="host__reader">
            <label class="field">
              Pack
              <select
                class="input"
                value={state.reading?.pack ?? ''}
                disabled={round.phase !== 'IDLE'}
                onChange={(e) => fire('selectPack', (e.target as HTMLSelectElement).value)}
              >
                <option value="">Choose a pack…</option>
                {state.packs.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            {state.reading?.rendering ? (
              <span class="chip chip--data">
                Rendering {state.reading.rendering.done}/{state.reading.rendering.total}
              </span>
            ) : state.reading ? (
              <>
                <button class="btn" onClick={() => fire(state.reading!.paused ? 'resumeRead' : 'pauseRead')}>
                  {state.reading.paused ? 'Resume' : 'Pause'}
                </button>
                <button class="btn" onClick={() => fire('read')}>Read</button>
                <button class="btn btn--ghost" onClick={() => fire('stopRead')}>Stop</button>
                <span class="chip">
                  Q{state.reading.qIndex + 1}/{state.reading.qTotal}
                  {state.reading.fragTotal > 0 &&
                    ` · fragment ${state.reading.fragIndex}/${state.reading.fragTotal}`}
                </span>
              </>
            ) : null}
          </div>
        )}
```

- [ ] **Step 3: Add the mirror toggle to `GameSettings`**

The mirror is framework-level, not a module option, so it belongs beside Teams
mode rather than in the schema-driven fields. In `client/Host.tsx`, inside the
`<details>` and next to the Teams mode checkbox:

```tsx
        <label class="field" style={{ margin: 'var(--s3) 0' }}>
          Mirror question text to phones
          <input
            type="checkbox"
            checked={state.mirrorFragments}
            onChange={(e) =>
              act({ a: 'setMirror', on: (e.target as HTMLInputElement).checked })
            }
          />
        </label>
```

- [ ] **Step 4: Keep the summary label fix**

`client/Host.tsx:213` should already read (from the uncommitted edit):

```tsx
        <summary>
          Game, players and teams · {state.games.find((g) => g.id === state.game.id)?.name} ·{' '}
          {state.players.length} joined
        </summary>
```

If it does not, apply it now — the section holds the mode dropdown and the
mirror toggle, and the old label named neither.

- [ ] **Step 5: Style the reader row**

Append to `client/style.css`, beside the other `host__` rules:

```css
.host__reader {
  display: flex;
  align-items: center;
  gap: var(--s3);
  flex-wrap: wrap;
  margin-top: var(--s3);
}
```

- [ ] **Step 6: Build and look at it**

Run: `npm run build && npm start`, then open `/host`.
Expected: a Pack row under the Correct/Wrong controls listing `sample.txt`.
Choosing it shows `Rendering n/N`, then Read/Pause/Stop and a `Q1/2` chip.
The `<details>` summary reads "Game, players and teams · Trivia · 0 joined" and
contains the mirror checkbox.

- [ ] **Step 7: Commit**

```bash
git add client/Host.tsx client/style.css
git commit -m "feat: pick the pack and drive the reader from the host screen"
```

---

### Task 9: Phones mirror the board

The phone is a second screen, so it shows what the board shows, at the same
instant. No mode surface and no registry override — the same reasoning the board
already follows.

**Files:**
- Modify: `client/Player.tsx:229-263`
- Modify: `client/style.css`

**Interfaces:**
- Consumes: `round.fragments` reaching player views when `mirrorFragments` is on (Task 6).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Render the fragments above the buzzer**

In `client/Player.tsx`, insert between the `player__bar` div and the
`player__lead-in` div (around line 244):

```tsx
      {!!round?.fragments?.length && (
        <p class="player__question">{round.fragments.join(' ')}</p>
      )}
```

No condition on `mirrorFragments` is needed or wanted: the server decides what
this phone may see, and the client renders what it was given. Putting the check
here too would be a second, weaker copy of the redaction rule.

- [ ] **Step 2: Style it**

Append to `client/style.css`:

```css
/* The phone as a second screen: readable at arm's length without stealing the
   buzzer's room. It scrolls rather than pushing the button off the screen. */
.player__question {
  margin: 0 0 var(--s3);
  max-height: 34vh;
  overflow-y: auto;
  font-size: var(--fs-2);
  line-height: 1.4;
  color: var(--fg);
}
```

If `--fs-2` or `--fg` are not the token names in `client/tokens.css`, use the
ones the other body-copy rules in `style.css` use — `docs/design.md` is the
source of truth for anything visual.

- [ ] **Step 3: Verify end to end with a real phone view**

```bash
npm run build && npm start
```

Open `/host`, tick "Mirror question text to phones", join from a second browser
window at `/`, pick `sample.txt`, press Read.

Expected: text appears on the phone as each fragment is spoken, and the buzzer
stays reachable. Untick the mirror and the text disappears from the phone while
the board keeps it.

- [ ] **Step 4: Confirm quizbowl is unaffected**

With the mirror **off**, switch the mode to Quizbowl-lite and read the pack.
Expected: the board shows fragments, the phone shows none — unchanged behaviour.

- [ ] **Step 5: Commit**

```bash
git add client/Player.tsx client/style.css
git commit -m "feat: phones mirror the board's question text when the room wants it"
```

---

### Task 10: Docs and final gates

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/manual-checklist.md`

- [ ] **Step 1: Update the commands block in `CLAUDE.md`**

Remove the `npm run read` line and add nothing in its place — reading is now a
host-screen control, not a command. In the Architecture list, add:

```
- `server/reader.ts` — the question loop. Drives the hub through a synthetic
  host connection, so it uses the same messages a socket client would and the
  hub grows no reader API.
- `server/speech.ts` — `say` pre-rendered to cached clips, played by `afplay`.
  Pause is SIGSTOP; the power boundary stays event-driven so pausing cannot
  desynchronise it.
- `server/packs.ts` — pack files on disk. `State` carries filenames only.
```

In "The parts that are load-bearing", add a short paragraph:

```
**The server reads, but never remembers.** Question content lives in server
memory while a pack is loaded and never enters `State` — only fragments the room
has already heard. That is what keeps a phone from seeing ahead, and it is why
the mirror is safe to offer at all.
```

- [ ] **Step 2: Update `README.md`**

Replace any `npm run read` instructions with: put `.txt` packs in `packs/`, pick
one on the host screen, press Read. Note that speech needs macOS (`say`,
`afplay`) and that without it the fragments still appear silently.

- [ ] **Step 3: Add a checklist line to `docs/manual-checklist.md`**

```
- [ ] Pack selected and rendered before guests arrive (first render is ~30s and
      caches; a re-read is instant)
- [ ] Mirror setting matches the game: off for quizbowl, on only if the room
      cannot see the board
```

- [ ] **Step 4: Full gates**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean, all green, `dist/` written.

- [ ] **Step 5: Confirm nothing still references the retired tool**

Run: `grep -rn "run read\|tools/read" --include=*.ts --include=*.md --include=*.json .`
Expected: no hits outside `docs/superpowers/` (the spec and this plan describe
the change and may name it).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/manual-checklist.md
git commit -m "docs: the host screen reads the pack"
```

---

## Self-Review Notes

**Spec coverage.** Reader into the server → Tasks 5, 6, 7. `shared/pack.ts` move
→ Task 1. `packs/*.txt` and `State.packs` → Tasks 1, 3, 6. Pre-rendered speech
with hash cache → Task 4. Playback and `SIGSTOP` pause → Task 4. Pause holds
audio only, `powerEndsAt` untouched → Task 5 (no hub gate, by construction).
Power boundary stays event-driven → Task 5, enforced by the `powerEnds` push
sitting inside the fragment loop. Undo abort via arm stamp → Task 5. `reading` in
`State`, display-only → Tasks 2, 6. Host UI → Task 8. `tools/read.ts` deleted →
Task 1. Mirror → Tasks 2, 6, 9. Error handling: no `say`/`afplay` → Task 4
(`durationMs: 0`); one bad fragment → Task 4 (same path); missing `packs/` →
Task 3 (`listPacks` returns `[]`) and Task 8 (the row hides); parse errors →
unchanged `parsePack`; pack selection mid-question refused → Task 7.

**Deliberate deviation from the spec.** The spec's `reading` shape omits
`fragTotal`, but its own host-UI example shows "fragment 2/3", which cannot be
rendered without it. Added, and named in Task 2's interface block.

**Not covered, by design.** Board-side playback, voice selection, pause that
blocks buzzing, and word-level reveal are all listed as out of scope in the spec.
`server/speech.ts` takes a `voice` argument and the cache key already includes it,
so voice selection stays a one-line UI addition later.
