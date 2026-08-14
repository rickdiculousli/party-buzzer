# Party Buzzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A LAN buzzer server for quizbowl/trivia where the host runs one command and players join by scanning a QR code with their phones.

**Architecture:** One Node process serves a static Preact bundle and runs a WebSocket hub at `/ws`. Game state lives in memory and snapshots to a JSON file. Phones sync a clock offset with the server and stamp buzzes locally; the server collects buzzes for 150ms after the first one, then orders them by corrected timestamp.

**Tech Stack:** Node 26.7.0 (via mise), `ws`, `qrcode`, Preact, Vite, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-14-party-buzzer-design.md`

## Global Constraints

- **Node 26.7.0**, pinned in `mise.toml`. No other runtime.
- **Native TypeScript only.** Node strips types at load; there is no build step for server code. This means: all relative imports MUST carry the `.ts` extension (`import { x } from './state.ts'`), and `enum`, `namespace`, and constructor parameter properties are FORBIDDEN — they require code generation. Use `type`, `interface`, and plain `const` objects.
- **Runtime dependencies: exactly `ws` and `qrcode`.** Client dependency: `preact`. Dev: `vite`, `@preact/preset-vite`, `typescript`. Adding anything else requires justification.
- **No network fetches at runtime.** Party WiFi has no internet. No CDN `<link>`, `<script src>`, `@import`, or webfont URL anywhere. All assets are bundled or generated locally.
- **Tests use `node:test` + `node:assert/strict`.** No Vitest, no Jest.
- **Time domain:** the server's clock is authoritative and read via `Date.now()`. Clients convert their monotonic `performance.now()` into server-domain milliseconds before sending. Every timestamp crossing the wire is server-domain `Date.now()` milliseconds.
- **Deliberate simplifications get a `ponytail:` comment** naming the ceiling and the upgrade path.

### Deviation from the spec (intentional)

The spec sketches the resolver as `(buzzes, armedAt, offsets) → ordered list`. This plan keeps the offset entirely client-side: the phone adds its own offset before sending, so the server never stores an offset table and the resolver takes `(buzzes, armedAt, excluded)`. The security property is unchanged, because it comes from the `[armedAt, arrivedAt]` clamp, not from who does the arithmetic.

---

## File Structure

| File | Responsibility |
|---|---|
| `mise.toml` | Pins Node 26.7.0 |
| `package.json` | Scripts and deps |
| `tsconfig.json` | Editor/typecheck settings only; never compiles |
| `vite.config.ts` | Builds `client/` to `dist/`; dev proxy for `/ws` |
| `shared/protocol.ts` | Every wire type. Imported by both sides. |
| `server/resolve.ts` | Pure buzz ordering. The correctness-critical unit. |
| `server/state.ts` | State shape, score keys, host actions, JSON persistence |
| `server/hub.ts` | Round state machine, grace window, connection registry, redaction |
| `server/net.ts` | LAN IPv4 detection, QR generation, boot banner |
| `server/index.ts` | HTTP server, static file serving, WebSocket upgrade |
| `client/index.html` | Single page shell |
| `client/main.tsx` | Route switch on `location.pathname` |
| `client/useSocket.ts` | Socket lifecycle, clock sync, reconnect |
| `client/Player.tsx` | Name entry, ready tap, buzzer |
| `client/Host.tsx` | Control panel |
| `client/Board.tsx` | Big-screen scoreboard and QR |
| `client/style.css` | All styling |
| `server/resolve.test.ts` | Resolver unit tests |
| `server/state.test.ts` | Scoring, lockout, persistence tests |
| `server/hub.test.ts` | State machine and redaction tests |
| `server/integration.test.ts` | Real server, real WebSocket clients, injected latency |

---

### Task 1: Toolchain and skeleton

**Files:**
- Create: `mise.toml`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `client/index.html`, `client/main.tsx`, `server/index.ts`, `server/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs `node --test`; `npm run dev` runs Vite; `npm start` runs `node server/index.ts`

- [ ] **Step 1: Pin Node with mise**

Create `mise.toml`:

```toml
[tools]
node = "26.7.0"
```

Then install and confirm:

```bash
mise install
mise exec -- node --version
```

Expected: `v26.7.0`

- [ ] **Step 2: Create package.json**

```json
{
  "name": "party-buzzer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server/index.ts",
    "dev": "vite",
    "build": "vite build",
    "test": "node --test 'server/*.test.ts'",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "qrcode": "^1.5.4",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.10.1",
    "@types/node": "^24.0.0",
    "@types/qrcode": "^1.5.5",
    "@types/ws": "^8.5.13",
    "preact": "^10.26.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 3: Create tsconfig.json**

This never emits — it exists so the editor and `npm run typecheck` understand the code.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["server", "client", "shared", "vite.config.ts"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  root: 'client',
  plugins: [preact()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/qr.svg': 'http://localhost:8080',
    },
  },
})
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
state.json
```

- [ ] **Step 6: Create the client shell**

`client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <title>Party Buzzer</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`client/style.css`:

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: #14141b;
  color: #f2f2f7;
  overscroll-behavior: none;
}
```

`client/main.tsx`:

```tsx
import { render } from 'preact'

function App() {
  return <p>party-buzzer</p>
}

render(<App />, document.getElementById('app')!)
```

- [ ] **Step 7: Create a placeholder server entry**

`server/index.ts`:

```ts
export const PORT = Number(process.env.PORT ?? 8080)
```

- [ ] **Step 8: Write a smoke test proving the toolchain runs TypeScript**

`server/smoke.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { PORT } from './index.ts'

test('runs typescript natively and reads the port', () => {
  const n: number = PORT
  assert.equal(n, 8080)
})
```

- [ ] **Step 9: Run the test**

Run: `npm test`
Expected: PASS, 1 test. If it fails with a TypeScript syntax error, Node is not 26.7.0 — recheck `mise install`.

- [ ] **Step 10: Verify the client builds**

Run: `npm run build`
Expected: writes `dist/index.html` and hashed assets, exits 0.

- [ ] **Step 11: Commit**

```bash
git add mise.toml package.json package-lock.json tsconfig.json vite.config.ts .gitignore client server
git commit -m "chore: scaffold party-buzzer toolchain on node 26"
```

---

### Task 2: Wire protocol types

**Files:**
- Create: `shared/protocol.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PlayerId`, `TeamId`, `ScoreKey`, `Phase`, `BuzzEntry`, `Player`, `Team`, `Round`, `State`, `Role`, `HostAction`, `ClientMsg`, `ServerMsg`. Every later task imports from here.

This task is types only, so there is no test — a type error in a later task is the test. Keep it complete and exact; later tasks reference these names verbatim.

- [ ] **Step 1: Write shared/protocol.ts**

```ts
export type PlayerId = string
export type TeamId = string
/** Scores key on team id in teams mode, player id in solo mode. */
export type ScoreKey = string

export type Role = 'player' | 'host' | 'board'
export type Mode = 'solo' | 'teams'
export type Phase = 'IDLE' | 'ARMED' | 'COLLECTING' | 'LOCKED'

export type Player = {
  id: PlayerId
  name: string
  teamId?: TeamId
  connected: boolean
}

export type Team = {
  id: TeamId
  name: string
  color: string
}

/** One resolved buzz. `at` is server-domain ms; `deltaMs` is ms behind first place. */
export type BuzzEntry = {
  playerId: PlayerId
  name: string
  at: number
  deltaMs: number
}

export type Round = {
  value: number
  phase: Phase
  armedAt: number
  /** Full list for host/board. Redacted to the recipient's own entry for players. */
  order: BuzzEntry[]
  /** How many buzzed in total, so a redacted player still sees "2 of 5". */
  total: number
  /** Score keys barred from this round after a wrong answer. */
  lockedOut: ScoreKey[]
}

export type State = {
  mode: Mode
  players: Player[]
  teams: Team[]
  scores: Record<ScoreKey, number>
  round: Round
}

export type HostAction =
  | { a: 'arm' }
  | { a: 'correct' }
  | { a: 'wrong'; neg: number }
  | { a: 'next' }
  | { a: 'resetRound' }
  | { a: 'setValue'; value: number }
  | { a: 'setScore'; key: ScoreKey; score: number }
  | { a: 'rename'; playerId: PlayerId; name: string }
  | { a: 'kick'; playerId: PlayerId }
  | { a: 'setMode'; mode: Mode }
  | { a: 'addTeam'; name: string; color: string }
  | { a: 'assign'; playerId: PlayerId; teamId?: TeamId }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; serverTime: number }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'state'; state: State }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add shared/protocol.ts
git commit -m "feat: define wire protocol types"
```

---

### Task 3: Buzz resolver

**Files:**
- Create: `server/resolve.ts`
- Test: `server/resolve.test.ts`

**Interfaces:**
- Consumes: nothing (deliberately dependency-free and pure)
- Produces: `type RawBuzz = { playerId: string; at: number; arrivedAt: number }` and `resolveBuzzes(buzzes: RawBuzz[], armedAt: number, excluded: string[]): { playerId: string; at: number; deltaMs: number }[]`

This is the correctness-critical unit. Write the tests first and make them all fail before implementing.

- [ ] **Step 1: Write the failing tests**

`server/resolve.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBuzzes, type RawBuzz } from './resolve.ts'

const buzz = (playerId: string, at: number, arrivedAt = at + 10): RawBuzz =>
  ({ playerId, at, arrivedAt })

test('orders by corrected stamp, not arrival order', () => {
  // Bea pressed first but her packet landed second.
  const out = resolveBuzzes(
    [buzz('amy', 1050, 1060), buzz('bea', 1020, 1080)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['bea', 'amy'])
})

test('reports deltaMs relative to first place', () => {
  const out = resolveBuzzes([buzz('amy', 1000), buzz('bea', 1038)], 900, [])
  assert.equal(out[0].deltaMs, 0)
  assert.equal(out[1].deltaMs, 38)
})

test('clamps a stamp that predates arming', () => {
  // Cheater claims to have buzzed before the question opened.
  const out = resolveBuzzes(
    [buzz('honest', 1010, 1020), buzz('cheat', -99999, 1015)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['cheat', 'honest'])
  assert.equal(out[0].at, 1000, 'clamped up to armedAt, not left in the past')
  assert.equal(out[1].deltaMs, 10)
})

test('clamps a stamp later than its own arrival', () => {
  const out = resolveBuzzes([buzz('amy', 5000, 1100)], 1000, [])
  assert.equal(out[0].at, 1100)
})

test('an unsynced client falls back to arrival order without breaking', () => {
  // offset never applied, so `at` equals the client's raw epoch: far in the past.
  const out = resolveBuzzes(
    [buzz('synced', 1020, 1030), buzz('unsynced', 0, 1005)],
    1000,
    [],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['unsynced', 'synced'])
  assert.equal(out[0].at, 1000)
})

test('breaks exact ties deterministically by arrival then id', () => {
  const a = resolveBuzzes([buzz('zoe', 1000, 1020), buzz('amy', 1000, 1010)], 900, [])
  assert.deepEqual(a.map((b) => b.playerId), ['amy', 'zoe'])

  const b = resolveBuzzes([buzz('zoe', 1000, 1010), buzz('amy', 1000, 1010)], 900, [])
  assert.deepEqual(b.map((b) => b.playerId), ['amy', 'zoe'])
})

test('drops excluded players', () => {
  const out = resolveBuzzes(
    [buzz('locked', 1000), buzz('open', 1050)],
    900,
    ['locked'],
  )
  assert.deepEqual(out.map((b) => b.playerId), ['open'])
  assert.equal(out[0].deltaMs, 0, 'first survivor is the new zero point')
})

test('keeps only the earliest buzz per player', () => {
  const out = resolveBuzzes(
    [buzz('amy', 1080, 1090), buzz('amy', 1010, 1020)],
    900,
    [],
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].at, 1010)
})

test('returns an empty list when everyone is excluded', () => {
  assert.deepEqual(resolveBuzzes([buzz('amy', 1000)], 900, ['amy']), [])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern=''` or simply `npm test`
Expected: FAIL — `Cannot find module './resolve.ts'`

- [ ] **Step 3: Implement the resolver**

`server/resolve.ts`:

```ts
export type RawBuzz = {
  playerId: string
  /** Client's own estimate of the press moment, already in server-domain ms. */
  at: number
  /** Server-domain ms when the packet actually landed. */
  arrivedAt: number
}

export type Resolved = {
  playerId: string
  at: number
  deltaMs: number
}

/**
 * Order buzzes by when they were actually pressed.
 *
 * A client's claimed stamp is trusted only within `[armedAt, arrivedAt]`: it
 * cannot predate the question opening, and cannot be later than the moment its
 * packet landed. That single clamp handles both a badly synced clock and a
 * client that hand-edits its timestamp.
 */
export function resolveBuzzes(
  buzzes: RawBuzz[],
  armedAt: number,
  excluded: string[],
): Resolved[] {
  const barred = new Set(excluded)
  const earliest = new Map<string, Resolved>()

  for (const b of buzzes) {
    if (barred.has(b.playerId)) continue
    const at = Math.min(Math.max(b.at, armedAt), b.arrivedAt)
    const prev = earliest.get(b.playerId)
    if (!prev || at < prev.at) {
      earliest.set(b.playerId, { playerId: b.playerId, at, deltaMs: 0 })
    }
  }

  const arrival = new Map(buzzes.map((b) => [b.playerId, b.arrivedAt]))
  const sorted = [...earliest.values()].sort(
    (x, y) =>
      x.at - y.at ||
      arrival.get(x.playerId)! - arrival.get(y.playerId)! ||
      x.playerId.localeCompare(y.playerId),
  )

  const first = sorted[0]?.at ?? 0
  return sorted.map((b) => ({ ...b, deltaMs: b.at - first }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 9 resolver tests plus the smoke test.

- [ ] **Step 5: Commit**

```bash
git add server/resolve.ts server/resolve.test.ts
git commit -m "feat: add clamped buzz resolver"
```

---

### Task 4: Game state and host actions

**Files:**
- Create: `server/state.ts`
- Test: `server/state.test.ts`

**Interfaces:**
- Consumes: `shared/protocol.ts` types
- Produces:
  - `newState(): State`
  - `scoreKey(state: State, playerId: PlayerId): ScoreKey`
  - `lockedPlayerIds(state: State): PlayerId[]`
  - `applyHostAction(state: State, action: HostAction): void` (mutates in place)
  - `loadState(path: string): State`
  - `saveState(path: string, state: State): void` (debounced 100ms)
  - `flushSave(): Promise<void>` (for tests and shutdown)

- [ ] **Step 1: Write the failing tests**

`server/state.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  newState, scoreKey, lockedPlayerIds, applyHostAction,
  loadState, saveState, flushSave,
} from './state.ts'
import type { State } from '../shared/protocol.ts'

function withPlayers(): State {
  const s = newState()
  s.players.push({ id: 'p1', name: 'Amy', connected: true })
  s.players.push({ id: 'p2', name: 'Bea', connected: true })
  s.scores.p1 = 0
  s.scores.p2 = 0
  return s
}

test('solo mode keys scores by player id', () => {
  const s = withPlayers()
  assert.equal(scoreKey(s, 'p1'), 'p1')
})

test('teams mode keys scores by team id', () => {
  const s = withPlayers()
  s.mode = 'teams'
  s.teams.push({ id: 't1', name: 'Red', color: '#e5484d' })
  s.players[0].teamId = 't1'
  assert.equal(scoreKey(s, 'p1'), 't1')
})

test('a teamless player in teams mode still keys by their own id', () => {
  const s = withPlayers()
  s.mode = 'teams'
  assert.equal(scoreKey(s, 'p1'), 'p1')
})

test('arm clears the previous order and stamps armedAt', () => {
  const s = withPlayers()
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'arm' })
  assert.equal(s.round.phase, 'ARMED')
  assert.deepEqual(s.round.order, [])
  assert.equal(s.round.total, 0)
  assert.ok(s.round.armedAt > 0)
})

test('correct awards the round value to the buzz leader and ends the round', () => {
  const s = withPlayers()
  s.round.value = 200
  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'correct' })
  assert.equal(s.scores.p1, 200)
  assert.equal(s.round.phase, 'IDLE')
})

test('correct in teams mode awards the team', () => {
  const s = withPlayers()
  s.mode = 'teams'
  s.teams.push({ id: 't1', name: 'Red', color: '#e5484d' })
  s.players[0].teamId = 't1'
  s.scores.t1 = 0
  s.round.value = 100
  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'correct' })
  assert.equal(s.scores.t1, 100)
})

test('wrong applies the neg, locks the key out, and re-arms', () => {
  const s = withPlayers()
  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'wrong', neg: 50 })
  assert.equal(s.scores.p1, -50)
  assert.deepEqual(s.round.lockedOut, ['p1'])
  assert.equal(s.round.phase, 'ARMED', 'rebound: buzzers reopen for everyone else')
  assert.deepEqual(s.round.order, [])
})

test('wrong in teams mode locks out the whole team', () => {
  const s = withPlayers()
  s.mode = 'teams'
  s.teams.push({ id: 't1', name: 'Red', color: '#e5484d' })
  s.players[0].teamId = 't1'
  s.players[1].teamId = 't1'
  s.scores.t1 = 0
  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'wrong', neg: 0 })
  assert.deepEqual(s.round.lockedOut, ['t1'])
  assert.deepEqual(lockedPlayerIds(s).sort(), ['p1', 'p2'])
})

test('wrong with a zero neg leaves the score alone', () => {
  const s = withPlayers()
  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'p1', name: 'Amy', at: 1, deltaMs: 0 }]
  applyHostAction(s, { a: 'wrong', neg: 0 })
  assert.equal(s.scores.p1, 0)
})

test('next clears lockouts and returns to idle', () => {
  const s = withPlayers()
  s.round.lockedOut = ['p1']
  s.round.phase = 'ARMED'
  applyHostAction(s, { a: 'next' })
  assert.deepEqual(s.round.lockedOut, [])
  assert.equal(s.round.phase, 'IDLE')
  assert.deepEqual(s.round.order, [])
})

test('kick removes the player and their solo score', () => {
  const s = withPlayers()
  applyHostAction(s, { a: 'kick', playerId: 'p1' })
  assert.deepEqual(s.players.map((p) => p.id), ['p2'])
  assert.equal(s.scores.p1, undefined)
})

test('rename changes the display name only', () => {
  const s = withPlayers()
  applyHostAction(s, { a: 'rename', playerId: 'p1', name: 'Amelia' })
  assert.equal(s.players[0].name, 'Amelia')
  assert.equal(s.players[0].id, 'p1')
})

test('setScore and setValue overwrite directly', () => {
  const s = withPlayers()
  applyHostAction(s, { a: 'setScore', key: 'p1', score: 999 })
  applyHostAction(s, { a: 'setValue', value: 400 })
  assert.equal(s.scores.p1, 999)
  assert.equal(s.round.value, 400)
})

test('addTeam then assign moves the player and seeds a team score', () => {
  const s = withPlayers()
  applyHostAction(s, { a: 'setMode', mode: 'teams' })
  applyHostAction(s, { a: 'addTeam', name: 'Red', color: '#e5484d' })
  const teamId = s.teams[0].id
  applyHostAction(s, { a: 'assign', playerId: 'p1', teamId })
  assert.equal(s.players[0].teamId, teamId)
  assert.equal(s.scores[teamId], 0)
})

test('assign with no team removes the player from their team', () => {
  const s = withPlayers()
  s.teams.push({ id: 't1', name: 'Red', color: '#e5484d' })
  s.players[0].teamId = 't1'
  applyHostAction(s, { a: 'assign', playerId: 'p1' })
  assert.equal(s.players[0].teamId, undefined)
})

test('a round survives save and load', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-'))
  const path = join(dir, 'state.json')
  try {
    const s = withPlayers()
    s.scores.p1 = 300
    saveState(path, s)
    await flushSave()
    assert.ok(existsSync(path))
    const back = loadState(path)
    assert.equal(back.scores.p1, 300)
    assert.equal(back.players.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loading a missing file yields a fresh game', () => {
  const s = loadState(join(tmpdir(), 'definitely-not-here-' + Date.now(), 'state.json'))
  assert.equal(s.players.length, 0)
  assert.equal(s.round.phase, 'IDLE')
})

test('players load back as disconnected until they reconnect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-'))
  const path = join(dir, 'state.json')
  try {
    saveState(path, withPlayers())
    await flushSave()
    const back = loadState(path)
    assert.deepEqual(back.players.map((p) => p.connected), [false, false])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './state.ts'`

- [ ] **Step 3: Implement the state module**

`server/state.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  HostAction, PlayerId, ScoreKey, State,
} from '../shared/protocol.ts'

export function newState(): State {
  return {
    mode: 'solo',
    players: [],
    teams: [],
    scores: {},
    round: {
      value: 100,
      phase: 'IDLE',
      armedAt: 0,
      order: [],
      total: 0,
      lockedOut: [],
    },
  }
}

/** Scores attach to the team in teams mode, otherwise to the player. */
export function scoreKey(state: State, playerId: PlayerId): ScoreKey {
  const player = state.players.find((p) => p.id === playerId)
  if (state.mode === 'teams' && player?.teamId) return player.teamId
  return playerId
}

/** Expand the round's locked-out score keys into the player ids they bar. */
export function lockedPlayerIds(state: State): PlayerId[] {
  const barred = new Set(state.round.lockedOut)
  return state.players
    .filter((p) => barred.has(scoreKey(state, p.id)))
    .map((p) => p.id)
}

function bump(state: State, key: ScoreKey, delta: number): void {
  state.scores[key] = (state.scores[key] ?? 0) + delta
}

export function applyHostAction(state: State, action: HostAction): void {
  const round = state.round
  const leader = round.order[0]

  switch (action.a) {
    case 'arm':
      round.phase = 'ARMED'
      round.armedAt = Date.now()
      round.order = []
      round.total = 0
      return

    case 'correct':
      if (leader) bump(state, scoreKey(state, leader.playerId), round.value)
      round.phase = 'IDLE'
      round.order = []
      round.total = 0
      round.lockedOut = []
      return

    case 'wrong': {
      if (!leader) return
      const key = scoreKey(state, leader.playerId)
      if (action.neg) bump(state, key, -action.neg)
      if (!round.lockedOut.includes(key)) round.lockedOut.push(key)
      // Rebound: reopen the buzzers for everyone not locked out.
      round.phase = 'ARMED'
      round.armedAt = Date.now()
      round.order = []
      round.total = 0
      return
    }

    case 'next':
    case 'resetRound':
      round.phase = 'IDLE'
      round.armedAt = 0
      round.order = []
      round.total = 0
      round.lockedOut = []
      return

    case 'setValue':
      round.value = action.value
      return

    case 'setScore':
      state.scores[action.key] = action.score
      return

    case 'rename': {
      const player = state.players.find((p) => p.id === action.playerId)
      if (player) player.name = action.name
      return
    }

    case 'kick':
      state.players = state.players.filter((p) => p.id !== action.playerId)
      delete state.scores[action.playerId]
      return

    case 'setMode':
      state.mode = action.mode
      return

    case 'addTeam': {
      const team = { id: randomUUID(), name: action.name, color: action.color }
      state.teams.push(team)
      state.scores[team.id] ??= 0
      return
    }

    case 'assign': {
      const player = state.players.find((p) => p.id === action.playerId)
      if (!player) return
      player.teamId = action.teamId
      if (action.teamId) state.scores[action.teamId] ??= 0
      return
    }
  }
}

// ponytail: rewrites the whole file on every change, debounced. State is a few
// KB and writes are rare, so this stays well under a millisecond. Switch to an
// append-only log only if a game ever grows large enough to stutter.
let pending: NodeJS.Timeout | undefined
let inFlight: Promise<void> = Promise.resolve()

export function saveState(path: string, state: State): void {
  clearTimeout(pending)
  const snapshot = JSON.stringify(state)
  inFlight = new Promise((resolve) => {
    pending = setTimeout(() => {
      try {
        writeFileSync(path, snapshot)
      } catch (err) {
        // A failed snapshot must never take the game down mid-question.
        console.error('[state] snapshot failed:', err)
      }
      resolve()
    }, 100)
    pending.unref?.()
  })
}

export function flushSave(): Promise<void> {
  return inFlight
}

export function loadState(path: string): State {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return newState()
  }

  try {
    const loaded = JSON.parse(raw) as State
    // Nobody is connected yet; sockets re-establish that on their own.
    for (const p of loaded.players) p.connected = false
    // A round mid-flight can't survive a restart: no timer, no pending buzzes.
    loaded.round.phase = 'IDLE'
    loaded.round.order = []
    loaded.round.total = 0
    return loaded
  } catch (err) {
    console.error('[state] snapshot unreadable, starting fresh:', err)
    return newState()
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all state tests green.

- [ ] **Step 5: Commit**

```bash
git add server/state.ts server/state.test.ts
git commit -m "feat: add game state, host actions, and snapshot persistence"
```

---

### Task 5: Connection hub and round state machine

**Files:**
- Create: `server/hub.ts`
- Test: `server/hub.test.ts`

**Interfaces:**
- Consumes: `resolveBuzzes` from `server/resolve.ts`; `applyHostAction`, `scoreKey`, `lockedPlayerIds`, `newState` from `server/state.ts`; protocol types
- Produces:
  - `type Conn = { id: string; role: Role; playerId?: PlayerId; send: (msg: ServerMsg) => void }`
  - `class Hub` with `constructor(state: State, opts?: { windowMs?: number; onChange?: (s: State) => void })`, and methods `add(conn)`, `remove(conn)`, `handle(conn, msg)`, `broadcast()`, `viewFor(conn): State`, plus a readonly `state` property

The hub is transport-agnostic on purpose: it never touches `ws`, so tests drive it with plain objects and Task 6 wires it to real sockets.

- [ ] **Step 1: Write the failing tests**

`server/hub.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import type { ServerMsg, Role } from '../shared/protocol.ts'

const WINDOW = 20

function fakeConn(id: string, role: Role): Conn & { sent: ServerMsg[] } {
  const sent: ServerMsg[] = []
  return { id, role, sent, send: (m) => sent.push(m) }
}

function lastState(conn: { sent: ServerMsg[] }) {
  const msgs = conn.sent.filter((m) => m.t === 'state')
  return msgs[msgs.length - 1]!.state
}

function setup() {
  const hub = new Hub(newState(), { windowMs: WINDOW })
  const host = fakeConn('h', 'host')
  hub.add(host)
  hub.handle(host, { t: 'hello', role: 'host' })
  return { hub, host }
}

function join(hub: Hub, id: string, name: string) {
  const conn = fakeConn(id, 'player')
  hub.add(conn)
  hub.handle(conn, { t: 'hello', role: 'player', name })
  return conn
}

test('a joining player gets a welcome with a stable id', () => {
  const { hub } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const welcome = amy.sent.find((m) => m.t === 'welcome')
  assert.ok(welcome && welcome.t === 'welcome')
  assert.ok(welcome.playerId.length > 0)
  assert.equal(hub.state.players[0].name, 'Amy')
})

test('reconnecting with a known playerId keeps identity and score', () => {
  const { hub } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const welcome = amy.sent.find((m) => m.t === 'welcome')!
  const id = welcome.t === 'welcome' ? welcome.playerId : ''
  hub.state.scores[id] = 400
  hub.remove(amy)
  assert.equal(hub.state.players[0].connected, false)

  const again = fakeConn('c2', 'player')
  hub.add(again)
  hub.handle(again, { t: 'hello', role: 'player', playerId: id })
  assert.equal(hub.state.players.length, 1, 'no duplicate player row')
  assert.equal(hub.state.players[0].connected, true)
  assert.equal(hub.state.scores[id], 400)
})

test('ping answers with the server clock and echoes t0', () => {
  const { hub } = setup()
  const amy = join(hub, 'c1', 'Amy')
  hub.handle(amy, { t: 'ping', t0: 12345 })
  const pong = amy.sent.find((m) => m.t === 'pong')
  assert.ok(pong && pong.t === 'pong')
  assert.equal(pong.t0, 12345)
  assert.ok(Math.abs(pong.serverTime - Date.now()) < 1000)
})

test('buzzing while idle is ignored', async () => {
  const { hub, host } = setup()
  const amy = join(hub, 'c1', 'Amy')
  hub.handle(amy, { t: 'buzz', at: Date.now() })
  await sleep(WINDOW * 3)
  assert.equal(hub.state.round.phase, 'IDLE')
  assert.deepEqual(lastState(host).round.order, [])
})

test('the grace window collects late buzzes and orders by press time', async () => {
  const { hub, host } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const bea = join(hub, 'c2', 'Bea')
  const amyId = hub.state.players.find((p) => p.name === 'Amy')!.id
  const beaId = hub.state.players.find((p) => p.name === 'Bea')!.id

  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  const armedAt = hub.state.round.armedAt

  // Amy's packet lands first, but Bea pressed 15ms earlier.
  hub.handle(amy, { t: 'buzz', at: armedAt + 40 })
  assert.equal(hub.state.round.phase, 'COLLECTING')
  hub.handle(bea, { t: 'buzz', at: armedAt + 25 })

  await sleep(WINDOW * 3)
  assert.equal(hub.state.round.phase, 'LOCKED')
  const order = lastState(host).round.order
  assert.deepEqual(order.map((b) => b.playerId), [beaId, amyId])
  assert.equal(order[1].deltaMs, 15)
  assert.equal(lastState(host).round.total, 2)
})

test('a buzz arriving after the window is ignored', async () => {
  const { hub, host } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const bea = join(hub, 'c2', 'Bea')
  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  hub.handle(amy, { t: 'buzz', at: Date.now() })
  await sleep(WINDOW * 3)
  hub.handle(bea, { t: 'buzz', at: Date.now() })
  await sleep(WINDOW * 3)
  assert.equal(lastState(host).round.order.length, 1)
})

test('a locked-out player cannot win the rebound', async () => {
  const { hub, host } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const bea = join(hub, 'c2', 'Bea')
  const beaId = hub.state.players.find((p) => p.name === 'Bea')!.id

  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  hub.handle(amy, { t: 'buzz', at: Date.now() })
  await sleep(WINDOW * 3)
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })
  assert.equal(hub.state.round.phase, 'ARMED', 're-armed for the rebound')

  // Amy buzzes again, earlier than Bea, but she is barred.
  const armedAt = hub.state.round.armedAt
  hub.handle(amy, { t: 'buzz', at: armedAt + 5 })
  hub.handle(bea, { t: 'buzz', at: armedAt + 30 })
  await sleep(WINDOW * 3)

  const order = lastState(host).round.order
  assert.deepEqual(order.map((b) => b.playerId), [beaId])
})

test('players see only their own entry, host and board see everyone', async () => {
  const { hub, host } = setup()
  const amy = join(hub, 'c1', 'Amy')
  const bea = join(hub, 'c2', 'Bea')
  const beaId = hub.state.players.find((p) => p.name === 'Bea')!.id

  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  const armedAt = hub.state.round.armedAt
  hub.handle(amy, { t: 'buzz', at: armedAt + 40 })
  hub.handle(bea, { t: 'buzz', at: armedAt + 10 })
  await sleep(WINDOW * 3)

  assert.equal(lastState(host).round.order.length, 2)
  const beaView = lastState(bea).round
  assert.deepEqual(beaView.order.map((b) => b.playerId), [beaId])
  assert.equal(beaView.total, 2, 'still learns how many buzzed')
})

test('non-host connections cannot send host actions', () => {
  const { hub } = setup()
  const amy = join(hub, 'c1', 'Amy')
  hub.handle(amy, { t: 'host', action: { a: 'setScore', key: 'anything', score: 9999 } })
  assert.deepEqual(hub.state.scores, {})
})

test('onChange fires so the caller can snapshot', async () => {
  let calls = 0
  const hub = new Hub(newState(), { windowMs: WINDOW, onChange: () => calls++ })
  const conn = fakeConn('c1', 'player')
  hub.add(conn)
  hub.handle(conn, { t: 'hello', role: 'player', name: 'Amy' })
  assert.ok(calls > 0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './hub.ts'`

- [ ] **Step 3: Implement the hub**

`server/hub.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { resolveBuzzes, type RawBuzz } from './resolve.ts'
import { applyHostAction, lockedPlayerIds } from './state.ts'
import type {
  ClientMsg, PlayerId, Role, ServerMsg, State,
} from '../shared/protocol.ts'

export type Conn = {
  id: string
  role: Role
  playerId?: PlayerId
  send: (msg: ServerMsg) => void
}

export type HubOpts = {
  /** Grace window in ms between the first buzz and locking the order. */
  windowMs?: number
  onChange?: (state: State) => void
}

export class Hub {
  readonly state: State
  private conns = new Set<Conn>()
  private pending: RawBuzz[] = []
  private timer: NodeJS.Timeout | undefined
  private windowMs: number
  private onChange: (state: State) => void

  constructor(state: State, opts: HubOpts = {}) {
    this.state = state
    this.windowMs = opts.windowMs ?? 150
    this.onChange = opts.onChange ?? (() => {})
  }

  add(conn: Conn): void {
    this.conns.add(conn)
  }

  remove(conn: Conn): void {
    this.conns.delete(conn)
    const player = this.state.players.find((p) => p.id === conn.playerId)
    if (player) player.connected = false
    this.changed()
  }

  handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        conn.role = msg.role
        if (msg.role === 'player') this.join(conn, msg.playerId, msg.name)
        else conn.send({ t: 'state', state: this.viewFor(conn) })
        return

      case 'ping':
        conn.send({ t: 'pong', t0: msg.t0, serverTime: Date.now() })
        return

      case 'buzz':
        this.buzz(conn, msg.at)
        return

      case 'host':
        // Only the host panel may mutate the game.
        if (conn.role !== 'host') return
        applyHostAction(this.state, msg.action)
        if (msg.action.a === 'arm' || msg.action.a === 'wrong') this.clearWindow()
        this.changed()
        return
    }
  }

  private join(conn: Conn, playerId: PlayerId | undefined, name?: string): void {
    let player = playerId
      ? this.state.players.find((p) => p.id === playerId)
      : undefined

    if (!player) {
      player = {
        id: playerId ?? randomUUID(),
        name: name?.trim() || 'Player',
        connected: true,
      }
      this.state.players.push(player)
      this.state.scores[player.id] ??= 0
    } else {
      player.connected = true
      if (name?.trim()) player.name = name.trim()
    }

    conn.playerId = player.id
    conn.send({ t: 'welcome', playerId: player.id, serverTime: Date.now() })
    this.changed()
  }

  private buzz(conn: Conn, at: number): void {
    const round = this.state.round
    if (!conn.playerId) return
    if (round.phase !== 'ARMED' && round.phase !== 'COLLECTING') return

    this.pending.push({
      playerId: conn.playerId,
      at,
      arrivedAt: Date.now(),
    })

    if (round.phase === 'ARMED') {
      round.phase = 'COLLECTING'
      this.timer = setTimeout(() => this.lock(), this.windowMs)
      this.timer.unref?.()
      this.changed()
    }
  }

  private lock(): void {
    const round = this.state.round
    const resolved = resolveBuzzes(
      this.pending,
      round.armedAt,
      lockedPlayerIds(this.state),
    )

    round.order = resolved.map((b) => ({
      playerId: b.playerId,
      name: this.state.players.find((p) => p.id === b.playerId)?.name ?? '?',
      at: b.at,
      deltaMs: b.deltaMs,
    }))
    round.total = round.order.length
    round.phase = 'LOCKED'
    this.pending = []
    this.timer = undefined
    this.changed()
  }

  private clearWindow(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = []
  }

  /**
   * Phones get the round redacted to their own buzz, so nobody can peek at
   * where they placed relative to the field before the host reveals it.
   */
  viewFor(conn: Conn): State {
    if (conn.role !== 'player') return this.state
    const round = this.state.round
    return {
      ...this.state,
      round: {
        ...round,
        order: round.order.filter((b) => b.playerId === conn.playerId),
      },
    }
  }

  broadcast(): void {
    for (const conn of this.conns) {
      conn.send({ t: 'state', state: this.viewFor(conn) })
    }
  }

  private changed(): void {
    this.broadcast()
    this.onChange(this.state)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all hub tests green.

- [ ] **Step 5: Commit**

```bash
git add server/hub.ts server/hub.test.ts
git commit -m "feat: add connection hub with grace window and player redaction"
```

---

### Task 6: HTTP server, LAN discovery, and boot banner

**Files:**
- Create: `server/net.ts`
- Modify: `server/index.ts` (replace the Task 1 placeholder entirely)
- Delete: `server/smoke.test.ts` (its job is done; Task 1's toolchain is proven by every other test)
- Test: `server/net.test.ts`

**Interfaces:**
- Consumes: `Hub`, `Conn` from `server/hub.ts`; `loadState`, `saveState` from `server/state.ts`
- Produces:
  - `lanAddresses(): string[]` — private IPv4s, most likely first
  - `pickAddress(candidates: string[], override?: string): string`
  - `banner(url: string, qr: string): string`
  - `startServer(opts?: { port?: number; statePath?: string; windowMs?: number }): Promise<{ url: string; port: number; hub: Hub; close: () => Promise<void> }>` from `server/index.ts`

`startServer` returning a handle is what makes Task 11's integration test possible — it must not be inlined into module top-level.

- [ ] **Step 1: Write the failing tests**

`server/net.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { lanAddresses, pickAddress, banner } from './net.ts'

test('lanAddresses returns only IPv4 private addresses', () => {
  for (const addr of lanAddresses()) {
    assert.match(addr, /^\d+\.\d+\.\d+\.\d+$/)
    assert.ok(
      addr.startsWith('192.168.') ||
        addr.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr),
      `${addr} should be a private range`,
    )
  }
})

test('pickAddress prefers 192.168 over other private ranges', () => {
  assert.equal(pickAddress(['10.1.2.3', '192.168.1.42']), '192.168.1.42')
})

test('pickAddress honours an explicit override', () => {
  assert.equal(pickAddress(['192.168.1.42'], '10.0.0.9'), '10.0.0.9')
})

test('pickAddress falls back to loopback when nothing is found', () => {
  assert.equal(pickAddress([]), '127.0.0.1')
})

test('banner shows the join URL and both operator URLs', () => {
  const out = banner('http://192.168.1.42:8080', 'QRQRQR')
  assert.match(out, /http:\/\/192\.168\.1\.42:8080/)
  assert.match(out, /\/host/)
  assert.match(out, /\/board/)
  assert.match(out, /QRQRQR/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './net.ts'`

- [ ] **Step 3: Implement net.ts**

```ts
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

const PRIVATE = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/

/** Private IPv4 addresses on this machine, excluding loopback and virtual NICs. */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    // Docker bridges and VPN tunnels are never the party WiFi.
    if (/^(docker|br-|veth|utun|tun|tap|awdl|llw)/i.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (PRIVATE.test(a.address)) out.push(a.address)
    }
  }
  return out
}

/** Home routers hand out 192.168.x.x, so prefer that when there's a choice. */
export function pickAddress(candidates: string[], override?: string): string {
  if (override) return override
  const preferred = candidates.find((a) => a.startsWith('192.168.'))
  return preferred ?? candidates[0] ?? '127.0.0.1'
}

export function qrFor(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'terminal', small: true })
}

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1 })
}

export function banner(url: string, qr: string): string {
  return [
    '',
    '  ┌─────────────────────────────────────────┐',
    '  │  PARTY BUZZER                           │',
    '  └─────────────────────────────────────────┘',
    '',
    `  Players join at:  ${url}`,
    '',
    qr,
    `  Host panel:   ${url}/host`,
    `  Big screen:   ${url}/board`,
    '',
    '  Ctrl-C to stop.',
    '',
  ].join('\n')
}
```

- [ ] **Step 4: Run the net tests to verify they pass**

Run: `npm test`
Expected: PASS — net tests green.

- [ ] **Step 5: Replace server/index.ts with the real server**

Delete `server/smoke.test.ts` first:

```bash
git rm server/smoke.test.ts
```

Then write `server/index.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Hub, type Conn } from './hub.ts'
import { loadState, saveState, flushSave } from './state.ts'
import { lanAddresses, pickAddress, banner, qrFor, qrSvg } from './net.ts'
import type { ClientMsg } from '../shared/protocol.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/** Client routes are served the SPA shell; unknown files 404. */
const ROUTES = new Set(['/', '/host', '/board'])

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]
  const file = ROUTES.has(path) ? 'index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '')
  const full = join(DIST, file)

  // Refuse anything that escaped the dist directory.
  if (!full.startsWith(DIST)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] ?? 'application/octet-stream',
      'cache-control': file === 'index.html' ? 'no-cache' : 'max-age=3600',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

export async function startServer(opts: {
  port?: number
  statePath?: string
  windowMs?: number
} = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8080)
  const statePath = opts.statePath ?? join(ROOT, 'state.json')

  const state = loadState(statePath)
  const hub = new Hub(state, {
    windowMs: opts.windowMs,
    onChange: (s) => saveState(statePath, s),
  })

  let joinUrl = ''

  const http = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/qr.svg')) {
      qrSvg(joinUrl).then(
        (svg) => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg),
        () => res.writeHead(500).end('qr failed'),
      )
      return
    }
    void serveStatic(req, res)
  })

  const wss = new WebSocketServer({ server: http, path: '/ws' })

  wss.on('connection', (socket) => {
    const conn: Conn = {
      id: crypto.randomUUID(),
      role: 'board',
      send: (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
      },
    }
    hub.add(conn)

    socket.on('message', (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        return // A malformed frame must never take the process down.
      }
      hub.handle(conn, msg)
    })

    socket.on('close', () => hub.remove(conn))
    socket.on('error', () => hub.remove(conn))
  })

  await new Promise<void>((resolve) => http.listen(port, '0.0.0.0', resolve))

  const actualPort = (http.address() as { port: number }).port
  const host = pickAddress(lanAddresses(), process.env.HOST_IP)
  joinUrl = `http://${host}:${actualPort}`

  return {
    url: joinUrl,
    port: actualPort,
    hub,
    close: async () => {
      for (const client of wss.clients) client.terminate()
      wss.close()
      await new Promise<void>((resolve) => http.close(() => resolve()))
      await flushSave()
    },
  }
}

// Only run the banner when launched directly, so tests can import cleanly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer()
  const candidates = lanAddresses()
  if (candidates.length > 1) {
    console.log(`  Multiple networks found: ${candidates.join(', ')}`)
    console.log(`  Using ${server.url}. Override with HOST_IP=<addr> npm start\n`)
  }
  console.log(banner(server.url, await qrFor(server.url)))

  process.on('SIGINT', () => {
    void server.close().then(() => process.exit(0))
  })
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS — nothing regressed.

- [ ] **Step 7: Verify the server actually boots**

Run: `npm run build && npm start`
Expected: a QR code and a `http://192.168.x.x:8080` join URL print to the terminal. Open that URL in a browser: it shows the Task 1 `party-buzzer` placeholder. Open `http://localhost:8080/qr.svg`: a QR image renders. Stop with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add server/index.ts server/net.ts server/net.test.ts
git rm --cached server/smoke.test.ts 2>/dev/null || true
git commit -m "feat: serve the app, detect the LAN address, and print a join QR"
```

---

### Task 7: Client socket with clock sync

**Files:**
- Create: `client/useSocket.ts`

**Interfaces:**
- Consumes: protocol types
- Produces: `useSocket(role: Role): { state: State | null; playerId: string | null; connected: boolean; now: () => number; send: (msg: ClientMsg) => void }`
  - `now()` returns the current moment in **server-domain milliseconds** — this is what `Player.tsx` stamps a buzz with.

There is no unit test here; a hook wrapping a live socket is verified by Task 11's integration test, which exercises the same clock-sync arithmetic against a real server.

- [ ] **Step 1: Write client/useSocket.ts**

```ts
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

const SAMPLES = 7
const RESYNC_MS = 30_000

/**
 * Clock sync, NTP style. `performance.now()` is monotonic, so a phone whose
 * wall clock jumps mid-game cannot corrupt the offset. We keep the median of
 * several samples after discarding the slowest round-trips, which are the ones
 * most distorted by WiFi jitter.
 */
function medianOffset(samples: { rtt: number; offset: number }[]): number {
  const best = [...samples]
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.ceil(samples.length / 2)))
    .map((s) => s.offset)
    .sort((a, b) => a - b)
  return best[Math.floor(best.length / 2)]
}

export function useSocket(role: Role) {
  const [state, setState] = useState<State | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(
    () => localStorage.getItem('playerId'),
  )
  const [connected, setConnected] = useState(false)

  const socket = useRef<WebSocket | null>(null)
  const offset = useRef(0)
  const samples = useRef<{ rtt: number; offset: number }[]>([])

  const send = (msg: ClientMsg) => {
    const s = socket.current
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg))
  }

  useEffect(() => {
    let closed = false
    let retry = 500
    let resync: ReturnType<typeof setInterval> | undefined

    const ping = () => {
      samples.current = []
      for (let i = 0; i < SAMPLES; i++) {
        setTimeout(() => send({ t: 'ping', t0: performance.now() }), i * 30)
      }
    }

    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/ws`)
      socket.current = ws

      ws.onopen = () => {
        retry = 500
        setConnected(true)
        send({
          t: 'hello',
          role,
          playerId: localStorage.getItem('playerId') ?? undefined,
          name: localStorage.getItem('playerName') ?? undefined,
        })
        ping()
        resync = setInterval(ping, RESYNC_MS)
      }

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMsg
        if (msg.t === 'state') setState(msg.state)
        else if (msg.t === 'welcome') {
          localStorage.setItem('playerId', msg.playerId)
          setPlayerId(msg.playerId)
        } else if (msg.t === 'pong') {
          const t1 = performance.now()
          samples.current.push({
            rtt: t1 - msg.t0,
            offset: msg.serverTime - (msg.t0 + t1) / 2,
          })
          if (samples.current.length >= SAMPLES) {
            offset.current = medianOffset(samples.current)
          }
        }
      }

      const reconnect = () => {
        setConnected(false)
        clearInterval(resync)
        if (closed) return
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 5000)
      }

      ws.onclose = reconnect
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      clearInterval(resync)
      socket.current?.close()
    }
  }, [role])

  return {
    state,
    playerId,
    connected,
    now: () => performance.now() + offset.current,
    send,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/useSocket.ts
git commit -m "feat: add client socket with NTP-style clock sync and reconnect"
```

---

### Task 8: Player page

**Files:**
- Create: `client/Player.tsx`
- Modify: `client/main.tsx` (route switch), `client/style.css` (append), `client/public/manifest.webmanifest`

**Interfaces:**
- Consumes: `useSocket` from `client/useSocket.ts`
- Produces: `export function Player()`

- [ ] **Step 1: Write client/Player.tsx**

```tsx
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSocket } from './useSocket.ts'

/** A short square-wave blip. Cheaper and more reliable than shipping an audio file. */
function blip(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = 660
  gain.gain.setValueAtTime(0.25, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.15)
}

export function Player() {
  const { state, playerId, connected, now, send } = useSocket('player')
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  const [ready, setReady] = useState(() => !!localStorage.getItem('playerId'))
  const audio = useRef<AudioContext | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)

  // Hold the screen awake while playing; re-acquire after the tab is hidden.
  useEffect(() => {
    if (!ready) return
    const acquire = async () => {
      try {
        wakeLock.current = await navigator.wakeLock?.request('screen')
      } catch {
        // Unsupported or denied. The game still works, the screen just dims.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void wakeLock.current?.release()
    }
  }, [ready])

  // The join tap doubles as the gesture that unlocks audio on iOS.
  const join = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('playerName', trimmed)
    audio.current = new AudioContext()
    void audio.current.resume()
    send({ t: 'hello', role: 'player', name: trimmed })
    setReady(true)
  }

  if (!ready) {
    return (
      <main class="join">
        <h1>Party Buzzer</h1>
        <input
          class="name"
          placeholder="Your name"
          value={name}
          maxLength={20}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="big" onClick={join} disabled={!name.trim()}>
          Tap to join
        </button>
        <p class="hint">Tapping also turns on the buzzer sound.</p>
      </main>
    )
  }

  const round = state?.round
  const open = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const mine = round?.order.find((b) => b.playerId === playerId)
  const key =
    state?.mode === 'teams'
      ? state.players.find((p) => p.id === playerId)?.teamId ?? playerId
      : playerId
  const barred = !!key && !!round?.lockedOut.includes(key)
  const score = key ? state?.scores[key] ?? 0 : 0

  const buzz = () => {
    if (!open || barred || mine) return
    // Stamp before anything else so render work never inflates the time.
    send({ t: 'buzz', at: now() })
    navigator.vibrate?.(60)
    if (audio.current) blip(audio.current)
  }

  // deltaMs is computed before redaction, so 0 means first across the whole field.
  const won = !!mine && mine.deltaMs === 0
  let label = 'WAIT'
  let mood = 'idle'
  if (barred) { label = 'LOCKED OUT'; mood = 'barred' }
  else if (mine && round?.phase === 'LOCKED') {
    label = won ? "YOU'RE UP" : `+${mine.deltaMs}ms`
    mood = won ? 'first' : 'placed'
  } else if (mine) { label = 'BUZZED'; mood = 'placed' }
  else if (open) { label = 'BUZZ'; mood = 'open' }

  return (
    <main class="player">
      <header>
        <span>{state?.players.find((p) => p.id === playerId)?.name}</span>
        <span class={connected ? 'dot on' : 'dot off'} />
        <span class="score">{score}</span>
      </header>
      <button
        class={`buzzer ${mood}`}
        onPointerDown={buzz}
        disabled={!open || barred || !!mine}
      >
        {label}
      </button>
    </main>
  )
}
```

Note on the rank label: the server redacts the order, so a phone knows its own `deltaMs` but not its numeric place. `deltaMs === 0` means it was first. Everyone else sees how far behind they were, which is the information that actually matters to a player.

- [ ] **Step 2: Update main.tsx to route**

```tsx
import { render } from 'preact'
import { Player } from './Player.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <p>host</p>
  if (path === '/board') return <p>board</p>
  return <Player />
}

render(<App />, document.getElementById('app')!)
```

- [ ] **Step 3: Add the PWA manifest**

`client/public/manifest.webmanifest`:

```json
{
  "name": "Party Buzzer",
  "short_name": "Buzzer",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#14141b",
  "theme_color": "#14141b"
}
```

Add to `client/index.html` inside `<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="apple-mobile-web-app-capable" content="yes" />
```

- [ ] **Step 4: Append player styles to client/style.css**

```css
.join, .player { display: flex; flex-direction: column; height: 100dvh; padding: 1.5rem; gap: 1rem; }
.join { align-items: center; justify-content: center; text-align: center; }
.name { font-size: 1.5rem; padding: .75rem 1rem; border-radius: .75rem; border: 2px solid #33333f; background: #1e1e28; color: inherit; width: 100%; max-width: 20rem; }
.big { font-size: 1.25rem; padding: 1rem 2rem; border-radius: .75rem; border: 0; background: #6e56cf; color: white; font-weight: 700; }
.big:disabled { opacity: .4; }
.hint { color: #9a9aa8; font-size: .875rem; }

.player header { display: flex; align-items: center; gap: .75rem; font-size: 1.125rem; }
.player header .score { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; }
.dot { width: .625rem; height: .625rem; border-radius: 50%; }
.dot.on { background: #30a46c; }
.dot.off { background: #e5484d; }

.buzzer {
  flex: 1; border: 0; border-radius: 1.5rem; font-size: 2rem; font-weight: 800;
  letter-spacing: .05em; color: white; background: #2a2a36;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  user-select: none; transition: background .08s;
}
.buzzer.open { background: #e5484d; }
.buzzer.open:active { background: #ff6369; }
.buzzer.first { background: #30a46c; }
.buzzer.placed { background: #46468a; }
.buzzer.barred { background: #3a2a2a; color: #8a6a6a; }
.buzzer:disabled { opacity: 1; }
```

- [ ] **Step 5: Verify in a browser**

Run: `npm run build && npm start`, then open the join URL on your laptop.
Expected: name entry appears; after joining, a grey WAIT button fills the screen. Leave it running for the next step.

- [ ] **Step 6: Verify buzzing end to end with a temporary arm**

With the server still running, arm the round from a second terminal:

```bash
node --input-type=module -e "
const ws = new WebSocket('ws://localhost:8080/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'hello', role: 'host' }));
  ws.send(JSON.stringify({ t: 'host', action: { a: 'arm' } }));
  setTimeout(() => process.exit(0), 300);
};
"
```

Expected: the browser button turns red and reads BUZZ. Click it — it turns green and reads YOU'RE UP within ~150ms. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add client/Player.tsx client/main.tsx client/style.css client/index.html client/public
git commit -m "feat: add player buzzer with wake lock and audio unlock"
```

---

### Task 9: Host panel

**Files:**
- Create: `client/Host.tsx`
- Modify: `client/main.tsx`, `client/style.css` (append)

**Interfaces:**
- Consumes: `useSocket`; `HostAction` type
- Produces: `export function Host()`

- [ ] **Step 1: Write client/Host.tsx**

```tsx
import { useSocket } from './useSocket.ts'
import type { HostAction, ScoreKey, State } from '../shared/protocol.ts'

function rows(state: State): { key: ScoreKey; label: string; score: number }[] {
  if (state.mode === 'teams') {
    return state.teams.map((t) => ({
      key: t.id,
      label: t.name,
      score: state.scores[t.id] ?? 0,
    }))
  }
  return state.players.map((p) => ({
    key: p.id,
    label: p.name,
    score: state.scores[p.id] ?? 0,
  }))
}

export function Host() {
  const { state, connected, send } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })

  if (!state) return <main class="host"><p>Connecting…</p></main>

  const { round } = state
  const leader = round.order[0]
  const open = round.phase === 'ARMED' || round.phase === 'COLLECTING'

  return (
    <main class="host">
      <header>
        <h1>Host</h1>
        <span class={connected ? 'dot on' : 'dot off'} />
        <label>
          Value
          <input
            type="number"
            step={100}
            value={round.value}
            onInput={(e) =>
              act({ a: 'setValue', value: Number((e.target as HTMLInputElement).value) })
            }
          />
        </label>
        <label>
          Teams
          <input
            type="checkbox"
            checked={state.mode === 'teams'}
            onChange={(e) =>
              act({
                a: 'setMode',
                mode: (e.target as HTMLInputElement).checked ? 'teams' : 'solo',
              })
            }
          />
        </label>
      </header>

      <section class="controls">
        <button class="arm" onClick={() => act({ a: 'arm' })} disabled={open}>
          {open ? 'Buzzers open' : 'Arm'}
        </button>
        <button class="ok" onClick={() => act({ a: 'correct' })} disabled={!leader}>
          Correct +{round.value}
        </button>
        <button
          class="no"
          onClick={() => act({ a: 'wrong', neg: round.value })}
          disabled={!leader}
        >
          Wrong −{round.value}
        </button>
        <button onClick={() => act({ a: 'wrong', neg: 0 })} disabled={!leader}>
          Wrong (no neg)
        </button>
        <button onClick={() => act({ a: 'next' })}>Next question</button>
      </section>

      <section class="buzzes">
        <h2>Buzz order · {round.phase}</h2>
        {round.order.length === 0 && <p class="muted">No buzzes yet.</p>}
        <ol>
          {round.order.map((b, i) => (
            <li key={b.playerId} class={i === 0 ? 'lead' : ''}>
              <span>{b.name}</span>
              <span class="delta">{i === 0 ? 'first' : `+${b.deltaMs}ms`}</span>
            </li>
          ))}
        </ol>
        {round.lockedOut.length > 0 && (
          <p class="muted">Locked out this question: {round.lockedOut.length}</p>
        )}
      </section>

      <section class="scores">
        <h2>Scores</h2>
        <table>
          {rows(state).map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>
                <input
                  type="number"
                  value={r.score}
                  onChange={(e) =>
                    act({
                      a: 'setScore',
                      key: r.key,
                      score: Number((e.target as HTMLInputElement).value),
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </table>
      </section>

      <section class="players">
        <h2>Players</h2>
        {state.mode === 'teams' && (
          <button onClick={() => act({ a: 'addTeam', name: `Team ${state.teams.length + 1}`, color: '#6e56cf' })}>
            Add team
          </button>
        )}
        <table>
          {state.players.map((p) => (
            <tr key={p.id}>
              <td>
                <span class={p.connected ? 'dot on' : 'dot off'} />
                <input
                  value={p.name}
                  onChange={(e) =>
                    act({
                      a: 'rename',
                      playerId: p.id,
                      name: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </td>
              {state.mode === 'teams' && (
                <td>
                  <select
                    value={p.teamId ?? ''}
                    onChange={(e) =>
                      act({
                        a: 'assign',
                        playerId: p.id,
                        teamId: (e.target as HTMLSelectElement).value || undefined,
                      })
                    }
                  >
                    <option value="">—</option>
                    {state.teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
              )}
              <td>
                <button onClick={() => act({ a: 'kick', playerId: p.id })}>Kick</button>
              </td>
            </tr>
          ))}
        </table>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Route to it in main.tsx**

```tsx
import { render } from 'preact'
import { Player } from './Player.tsx'
import { Host } from './Host.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <Host />
  if (path === '/board') return <p>board</p>
  return <Player />
}

render(<App />, document.getElementById('app')!)
```

- [ ] **Step 3: Append host styles to client/style.css**

```css
.host { max-width: 60rem; margin: 0 auto; padding: 1.5rem; display: grid; gap: 1.5rem; }
.host header { display: flex; align-items: center; gap: 1rem; }
.host h1 { margin: 0; font-size: 1.25rem; }
.host h2 { margin: 0 0 .5rem; font-size: .875rem; text-transform: uppercase; letter-spacing: .08em; color: #9a9aa8; }
.host label { display: flex; align-items: center; gap: .375rem; font-size: .875rem; color: #9a9aa8; }
.host input, .host select { background: #1e1e28; border: 1px solid #33333f; border-radius: .375rem; color: inherit; padding: .375rem .5rem; font: inherit; }
.host input[type=number] { width: 6rem; }
.controls { display: flex; flex-wrap: wrap; gap: .75rem; }
.controls button { font-size: 1rem; font-weight: 600; padding: .75rem 1.25rem; border: 0; border-radius: .5rem; background: #2a2a36; color: inherit; }
.controls button:disabled { opacity: .35; }
.controls .arm { background: #6e56cf; color: white; }
.controls .ok { background: #30a46c; color: white; }
.controls .no { background: #e5484d; color: white; }
.buzzes ol { list-style: none; padding: 0; margin: 0; display: grid; gap: .25rem; }
.buzzes li { display: flex; justify-content: space-between; padding: .5rem .75rem; background: #1e1e28; border-radius: .375rem; }
.buzzes li.lead { background: #30a46c; color: white; font-weight: 700; }
.delta { font-variant-numeric: tabular-nums; opacity: .8; }
.muted { color: #9a9aa8; font-size: .875rem; }
.host table { width: 100%; border-collapse: collapse; }
.host td { padding: .25rem 0; }
.host button { background: #2a2a36; color: inherit; border: 0; border-radius: .375rem; padding: .375rem .75rem; }
```

- [ ] **Step 4: Verify the full loop by hand**

Run: `npm run build && npm start`. Open `/host` on the laptop and `/` in two other browser windows, joining as two players.
Expected: both players appear in the host list with green dots. Click Arm — both buzzers go red. Buzz from one; within ~150ms the host shows the buzz order and that phone shows YOU'RE UP. Click Wrong — that player's button reads LOCKED OUT and the other's reopens. Click Correct on the second — their score increases by the round value.

- [ ] **Step 5: Commit**

```bash
git add client/Host.tsx client/main.tsx client/style.css
git commit -m "feat: add host control panel"
```

---

### Task 10: Board page

**Files:**
- Create: `client/Board.tsx`
- Modify: `client/main.tsx`, `client/style.css` (append)

**Interfaces:**
- Consumes: `useSocket`
- Produces: `export function Board()`

- [ ] **Step 1: Write client/Board.tsx**

```tsx
import { useSocket } from './useSocket.ts'
import type { State } from '../shared/protocol.ts'

function standings(state: State) {
  const rows =
    state.mode === 'teams'
      ? state.teams.map((t) => ({ key: t.id, label: t.name, color: t.color }))
      : state.players.map((p) => ({ key: p.id, label: p.name, color: '#6e56cf' }))
  return rows
    .map((r) => ({ ...r, score: state.scores[r.key] ?? 0 }))
    .sort((a, b) => b.score - a.score)
}

export function Board() {
  const { state } = useSocket('board')
  if (!state) return <main class="board"><p>Connecting…</p></main>

  const { round } = state
  const leader = round.order[0]
  const open = round.phase === 'ARMED' || round.phase === 'COLLECTING'

  return (
    <main class="board">
      <section class="stage">
        {leader ? (
          <>
            <p class="who">{leader.name}</p>
            <ol class="rest">
              {round.order.slice(1).map((b) => (
                <li key={b.playerId}>{b.name} <span class="delta">+{b.deltaMs}ms</span></li>
              ))}
            </ol>
          </>
        ) : (
          <p class={open ? 'armed' : 'idle'}>{open ? 'BUZZ!' : 'Ready'}</p>
        )}
      </section>

      <aside class="side">
        <ol class="standings">
          {standings(state).map((r) => (
            <li key={r.key} style={{ borderColor: r.color }}>
              <span>{r.label}</span>
              <span class="score">{r.score}</span>
            </li>
          ))}
        </ol>
        <div class="join-qr">
          <img src="/qr.svg" alt="Scan to join" />
          <p>Scan to join</p>
        </div>
      </aside>
    </main>
  )
}
```

- [ ] **Step 2: Route to it in main.tsx**

```tsx
import { render } from 'preact'
import { Player } from './Player.tsx'
import { Host } from './Host.tsx'
import { Board } from './Board.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <Host />
  if (path === '/board') return <Board />
  return <Player />
}

render(<App />, document.getElementById('app')!)
```

- [ ] **Step 3: Append board styles to client/style.css**

```css
.board { display: grid; grid-template-columns: 1fr 22rem; height: 100dvh; }
.stage { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 2rem; text-align: center; }
.stage .who { font-size: clamp(3rem, 11vw, 9rem); font-weight: 900; margin: 0; color: #30a46c; line-height: 1; }
.stage .armed { font-size: clamp(3rem, 12vw, 10rem); font-weight: 900; margin: 0; color: #e5484d; }
.stage .idle { font-size: clamp(2rem, 6vw, 4rem); margin: 0; color: #55556a; }
.rest { list-style: none; padding: 0; margin: 0; display: flex; gap: 1.5rem; font-size: 1.5rem; color: #9a9aa8; }
.side { background: #1a1a22; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
.standings { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; flex: 1; align-content: start; }
.standings li { display: flex; justify-content: space-between; font-size: 1.5rem; padding: .5rem .75rem; border-left: .375rem solid; background: #22222c; border-radius: .375rem; }
.standings .score { font-variant-numeric: tabular-nums; font-weight: 800; }
.join-qr { text-align: center; }
.join-qr img { width: 100%; max-width: 12rem; background: white; padding: .5rem; border-radius: .5rem; }
.join-qr p { color: #9a9aa8; margin: .5rem 0 0; }
```

- [ ] **Step 4: Verify on screen**

Run: `npm run build && npm start`, open `/board`.
Expected: standings on the right with a scannable QR beneath them, "Ready" in the centre. Arm from `/host` and the centre turns red with BUZZ!. Buzz from a phone and the winner's name fills the screen. Scan the on-screen QR with a phone — it opens the join page.

- [ ] **Step 5: Commit**

```bash
git add client/Board.tsx client/main.tsx client/style.css
git commit -m "feat: add big-screen board with standings and join QR"
```

---

### Task 11: End-to-end integration test

**Files:**
- Test: `server/integration.test.ts`

**Interfaces:**
- Consumes: `startServer` from `server/index.ts`
- Produces: nothing — this is the top of the test pyramid

This test uses Node's built-in global `WebSocket` client. It proves the property the whole design exists for: **the player who physically pressed first wins, even when their packet arrives last.**

- [ ] **Step 1: Write the failing test**

`server/integration.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { startServer } from './index.ts'
import type { ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

const WINDOW = 60

/** A fake participant: real socket, real JSON frames, optional injected lag. */
class FakeClient {
  ws!: WebSocket
  playerId = ''
  states: State[] = []
  offset = 0

  constructor(private url: string, private role: Role, private lagMs = 0) {}

  /** Pass `playerId` to rejoin as an existing player, the way a reloaded phone does. */
  async open(name?: string, playerId?: string): Promise<void> {
    this.ws = new WebSocket(`${this.url.replace('http', 'ws')}/ws`)
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('socket failed'))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      if (msg.t === 'state') this.states.push(msg.state)
      else if (msg.t === 'welcome') this.playerId = msg.playerId
      else if (msg.t === 'pong') {
        this.offset = msg.serverTime - (msg.t0 + performance.now()) / 2
      }
    }
    this.send({ t: 'hello', role: this.role, name, playerId })
    await sleep(30)
  }

  send(msg: ClientMsg): void {
    const fire = () => this.ws.send(JSON.stringify(msg))
    if (this.lagMs) setTimeout(fire, this.lagMs)
    else fire()
  }

  /** Sync the clock the same way the browser hook does. */
  async sync(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      this.ws.send(JSON.stringify({ t: 'ping', t0: performance.now() }))
      await sleep(10)
    }
  }

  get last(): State {
    return this.states[this.states.length - 1]
  }

  close(): void {
    this.ws.close()
  }
}

async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-e2e-'))
  const server = await startServer({
    port: 0,
    statePath: join(dir, 'state.json'),
    windowMs: WINDOW,
  })
  try {
    await fn(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the player who pressed first wins despite arriving last', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    // Bea is on a bad connection: her packets take 40ms longer than Amy's.
    const amy = new FakeClient(url, 'player', 0)
    const bea = new FakeClient(url, 'player', 40)
    await host.open()
    await amy.open('Amy')
    await bea.open('Bea')
    await amy.sync()
    await bea.sync()

    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(30)

    // Bea physically presses 20ms before Amy.
    bea.send({ t: 'buzz', at: performance.now() + bea.offset })
    await sleep(20)
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })

    await sleep(WINDOW + 150)

    const order = host.last.round.order
    assert.equal(host.last.round.phase, 'LOCKED')
    assert.deepEqual(
      order.map((b) => b.name),
      ['Bea', 'Amy'],
      'arrival order would have put Amy first; press order must win',
    )
    assert.ok(order[1].deltaMs >= 10, `expected ~20ms gap, got ${order[1].deltaMs}`)

    for (const c of [host, amy, bea]) c.close()
  })
})

test('a player reconnects with the same identity and score', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')

    host.send({ t: 'host', action: { a: 'setScore', key: amy.playerId, score: 700 } })
    await sleep(30)
    amy.close()
    await sleep(50)

    const again = new FakeClient(url, 'player')
    await again.open(undefined, amy.playerId)
    await sleep(50)

    assert.equal(host.last.players.length, 1, 'no duplicate player on reconnect')
    assert.equal(host.last.players[0].connected, true)
    assert.equal(host.last.players[0].name, 'Amy', 'name survived the reconnect')
    assert.equal(host.last.scores[amy.playerId], 700)

    again.close()
    host.close()
  })
})

test('phones never receive another player\'s buzz', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    const bea = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')
    await bea.open('Bea')

    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(30)
    amy.send({ t: 'buzz', at: Date.now() })
    bea.send({ t: 'buzz', at: Date.now() })
    await sleep(WINDOW + 150)

    assert.equal(host.last.round.order.length, 2)
    assert.deepEqual(amy.last.round.order.map((b) => b.playerId), [amy.playerId])
    assert.equal(amy.last.round.total, 2)

    for (const c of [host, amy, bea]) c.close()
  })
})

test('the game survives a server restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-restart-'))
  const statePath = join(dir, 'state.json')
  try {
    const first = await startServer({ port: 0, statePath, windowMs: WINDOW })
    const url = `http://127.0.0.1:${first.port}`
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')
    host.send({ t: 'host', action: { a: 'setScore', key: amy.playerId, score: 250 } })
    await sleep(50)
    host.close()
    amy.close()
    await first.close()

    const second = await startServer({ port: 0, statePath, windowMs: WINDOW })
    const back = new FakeClient(`http://127.0.0.1:${second.port}`, 'host')
    await back.open()

    assert.equal(back.last.scores[amy.playerId], 250)
    assert.equal(back.last.players[0].name, 'Amy')
    assert.equal(back.last.round.phase, 'IDLE')

    back.close()
    await second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. If `startServer` is not exported from `server/index.ts`, or was invoked at module top level, fix Task 6 before continuing — the test must be able to import the module without booting a listener.

- [ ] **Step 3: Fix whatever the test exposes**

No new production code should be needed; Tasks 3–6 cover the behaviour. Common fixes at this point:
- `startServer` still calls `listen` on the default port when imported → guard the banner block with the `import.meta.url` check from Task 6.
- Timing flake on a loaded machine → raise `WINDOW` and the `sleep` margins, never lower them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all four integration tests.

- [ ] **Step 5: Run the whole suite ten times to check for flake**

```bash
for i in $(seq 1 10); do npm test --silent || { echo "FLAKE on run $i"; break; }; done
```

Expected: ten clean runs. Timing tests that pass nine times out of ten are broken tests — raise the margins until they are deterministic.

- [ ] **Step 6: Commit**

```bash
git add server/integration.test.ts
git commit -m "test: prove press order beats arrival order end to end"
```

---

### Task 12: README and hardware checklist

**Files:**
- Modify: `README.md`
- Create: `docs/manual-checklist.md`

**Interfaces:**
- Consumes: everything
- Produces: the documentation a host needs on party night

The checklist covers what no automated test can reach: real phones, real vibration, real iOS audio.

- [ ] **Step 1: Write README.md**

````markdown
# party-buzzer

A LAN buzzer for quizbowl, pub trivia, and Jeopardy nights. Host runs one
command; players join by scanning a QR code. No internet required.

## Run it

```bash
mise install     # Node 26.7.0
npm install
npm run build
npm start
```

The terminal prints a QR code and a join URL. Players scan it. Open `/host` on
your laptop and `/board` on the TV.

If several networks are detected, the server says which one it chose. Override
with `HOST_IP=192.168.1.42 npm start`.

## How a question runs

1. **Arm** — buzzers go live on every phone.
2. Players buzz. The first press starts a 150ms window; everyone who buzzes
   inside it is ranked by when they actually pressed, not when their packet
   arrived.
3. **Correct** awards the round value. **Wrong** applies a neg, locks that
   player (or team) out, and reopens the buzzers for everyone else.
4. **Next question** clears the lockouts.

## Fairness

Phones sync a clock offset with the server on connect and stamp the buzz at the
moment of touch. Each claimed stamp is clamped to `[armedAt, arrivedAt]`, so a
buzz can never predate the question opening or postdate its own packet. That
makes both a badly synced clock and a hand-edited timestamp harmless.

## Development

```bash
npm run dev        # Vite with HMR; run `npm start` alongside it for the API
npm test           # node:test
npm run typecheck
```

Game state lives in `state.json` beside the repo. Delete it to start fresh.
````

- [ ] **Step 2: Write docs/manual-checklist.md**

```markdown
# Manual checklist

Automated tests cover ordering, scoring, and reconnection. These need real
hardware — run them once before a real game night.

## Per phone (test at least one iPhone and one Android)

- [ ] Scanning the QR from the camera app opens the join page
- [ ] Scanning the QR shown on `/board` works from across the room
- [ ] After joining, the buzzer fills the screen with no scroll or bounce
- [ ] Pressing the buzzer vibrates
- [ ] Pressing the buzzer makes a sound — **the iOS case**: audio must work on
      the first buzz of the night, proving the join tap unlocked the audio
      context
- [ ] The screen does not dim or sleep while the buzzer page is open
- [ ] Locking and unlocking the phone returns to a working buzzer within a
      second or two
- [ ] Walking out of WiFi range and back reconnects automatically, keeping the
      same name and score
- [ ] Reloading the page keeps the same identity
- [ ] "Add to Home Screen" produces a working full-screen app

## Room

- [ ] `/board` is readable from the far side of the room
- [ ] Ten or more phones joined at once, all appearing on the host panel
- [ ] Two players buzzing near-simultaneously produce a plausible winner and a
      believable millisecond gap
- [ ] Host laptop sleeping and waking does not lose scores
```

- [ ] **Step 3: Verify the README instructions from scratch**

```bash
rm -rf node_modules dist state.json && mise install && npm install && npm run build && npm start
```

Expected: the documented steps work verbatim on a clean checkout. Stop with Ctrl-C.

- [ ] **Step 4: Run the full suite one final time**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-checklist.md
git commit -m "docs: add README and hardware checklist"
```

---

## Self-Review Notes

Checked against the spec:

| Spec requirement | Task |
|---|---|
| Node + ws + Vite/Preact, three routes | 1, 6, 8–10 |
| No internet at runtime | 1 (no CDN in `index.html`), 6 (`/qr.svg` server-generated), 8 (WebAudio blip instead of an audio file) |
| LAN IPv4 detection, ambiguity prompt | 6 (`pickAddress` + the multi-network notice with `HOST_IP` override) |
| Terminal QR and board QR | 6 (`qrFor`, `qrSvg`), 10 |
| PWA manifest, install optional | 8 |
| `playerId` in localStorage, reconnect keeps score | 5, 7, 11 |
| Tap-to-ready unlocks iOS audio | 8 |
| NTP clock sync, 7 samples, median, 30s resync | 7 |
| `pointerdown` not `click`, local feedback | 8 |
| `IDLE → ARMED → COLLECTING → LOCKED`, 150ms window | 5 |
| `[armedAt, arrivedAt]` clamp | 3 |
| Host/board see full order with deltas; phones see only their own | 5 (`viewFor`), 9, 10 |
| State shape, team-or-player score keys | 2, 4 |
| Debounced `writeFileSync`, load on boot | 4 |
| Arm / Correct / Wrong / Next, `lockedOut` rebound | 4, 9 |
| Value stepper, manual score edit, rename, kick, mode toggle | 9 |
| Wake lock, reconnect backoff, late buzz ignored, duplicate names | 5, 7, 8 |
| Resolver unit tests (5 named cases) | 3 — all five, plus four more |
| Integration test, ephemeral port, injected latency | 11 |
| Manual phone checklist | 12 |

**Deviations, both stated at the point of use:** the resolver takes `excluded` rather than `offsets` (offsets stay client-side); Vitest is replaced by `node:test` because Node 26 ships it and the spec already excluded component tests.

**Excluded by the spec, and absent here on purpose:** per-question timers, wagering, buzz history stats, undo, E2E browser rig, load testing.
