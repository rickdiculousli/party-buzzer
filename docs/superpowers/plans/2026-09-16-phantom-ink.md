# Phantom Ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a turn-based, freehand-ink Phantom Ink minigame (`ink`) with a player-picked team lobby, team votes and shared touch rings.

**Architecture:** `MinigameRuntime` gains optional untimed matches, a ready-phase lobby, prepare/start refusals and touch relay. The rules live in a pure `server/minigames/ink/world.ts` driven through the existing `minigameInput` path. Phones draw strokes and vote; the board renders the pad from frames that carry the full pad only when it changed.

**Tech Stack:** Node native TypeScript server, Preact client, SVG, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-phantom-ink-design.md`

## Global Constraints

- Relative imports use `.ts` / `.tsx` extensions. No enums, no constructor parameter properties.
- Identifiers use the spec's Names table: `guesser`, `writer`, `secret`, `prompt`, `wordCard`, `peek`, `clue`, `pad`. Never `question`, `answer`, `round` or `hold` for ink concepts.
- UI labels: Guesser, Writer, Secret word, Prompt, Ask, Guess, Stop, Done, End clue, Check, Correct letter, Wrong letter, Finish guess, Win, Not it, Undo last stroke, Vote, Force, Redraw hand, Join Sun, Join Moon, Volunteer to write.
- Pad: 8 rows per team. Peek rows (1-based): Sun 4, 6, 7; Moon 3, 5, 6. Hand size 7; Ask draws 2.
- Team capacity = ceil(connected players / 2); overfill allowed, shown in `--tally`.
- Start refusals: `unpicked`, `team-too-small` (< 2 members), `ink-cards`.
- Touch rings fade over 600 ms. Force needs a 2 s press. Stroke coordinates are row-normalized 0..1, rounded to 3 decimals, at most 500 points per stroke.
- Bow and tank behavior is unchanged.
- Comments describe the code as it is now, never its history.
- Tests: `npm test`; `npm run typecheck`; `npm run build`.

## File map

| File | Responsibility |
|---|---|
| `shared/protocol.ts` | `ink` id, `InkInput`, ink frames, `MinigameLobby`, lobby/touch messages |
| `shared/legality.ts`, `client/ui.ts` | New refusal codes and their text |
| `server/minigames/definition.ts` | Optional `untimed`, `finished`, `prepare`, `startable`, `touchAudience`; `create` gets the lobby |
| `server/minigames/lobby.ts` | Pure lobby edits and start check |
| `server/minigames/runtime.ts` | Untimed pump, lobby and touch entry points |
| `server/hub.ts` | Route `minigameLobby` and `minigameTouch` |
| `server/minigames/ink/cards.ts` | Parse and load `packs/phantom-ink.txt` |
| `server/minigames/ink/types.ts` | World types and constants |
| `server/minigames/ink/world.ts` | Pure rules |
| `server/minigames/ink/definition.ts` | Input classification, frames, visibility, registry entry |
| `client/ink.ts` | Pure client helpers (capacity, stroke paths, quantize, touch pruning) |
| `client/InkParts.tsx` | Lobby, pad, canvas, touch layer, vote pips |
| `client/InkPlayer.tsx`, `client/InkBoard.tsx` | Surfaces |
| `client/minigames.tsx`, `client/useSocket.ts`, `client/Host.tsx`, `client/style.css` | Registry, touches, untimed host panel, styles |
| `tools/sim-ink.ts` | Self-play walkthrough |

---

### Task 1: Runtime and protocol extensions

**Files:**
- Modify: `shared/protocol.ts`, `shared/legality.ts`, `client/ui.ts`
- Modify: `server/minigames/definition.ts`, `server/minigames/runtime.ts`, `server/hub.ts`
- Create: `server/minigames/lobby.ts`, `server/minigames/lobby.test.ts`
- Test: `server/minigames/runtime.test.ts`, `server/hub.test.ts`

**Interfaces:**
- Produces:
  - `type MinigameLobby = { teams: Record<PlayerId, 'sun' | 'moon'>; volunteers: PlayerId[] }`
  - `type LobbyChange = { do: 'join'; team: 'sun' | 'moon' } | { do: 'leave' } | { do: 'volunteer'; on: boolean }`
  - `applyLobby(lobby: MinigameLobby, playerId: PlayerId, change: LobbyChange): boolean`
  - `lobbyStartable(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null`
  - `teamMembers(lobby: MinigameLobby, connected: PlayerId[], team: 'sun' | 'moon'): PlayerId[]`
  - `MinigameRuntime.lobby(playerId, change): boolean`, `MinigameRuntime.touch(playerId, msg): TouchAudience | null`
  - `type TouchAudience = { players: PlayerId[]; board: boolean }`
  - ServerMsg `{ t: 'minigameTouch'; touch: MinigameTouch }` with `MinigameTouch = { playerId; name; target: string; x: number; y: number }`
  - ClientMsg `{ t: 'minigameLobby'; change: LobbyChange }` and `{ t: 'minigameTouch'; matchId: string; target: string; x: number; y: number }`

- [ ] **Step 1: Protocol additions**

In `shared/protocol.ts`:

```ts
export type InkTeamName = 'sun' | 'moon'

export type MinigameLobby = { teams: Record<PlayerId, InkTeamName>; volunteers: PlayerId[] }

export type LobbyChange =
  | { do: 'join'; team: InkTeamName }
  | { do: 'leave' }
  | { do: 'volunteer'; on: boolean }

export type MinigameTouch = { playerId: PlayerId; name: string; target: string; x: number; y: number }
```

Add `lobby?: MinigameLobby` to `MinigameState` with the comment `/** Team picks made during ready. Kept across cancel. */`.

Extend `MinigameInputAck['reason']` with `| 'not-allowed'`.

Add to `ClientMsg`:

```ts
  | { t: 'minigameLobby'; change: LobbyChange }
  | { t: 'minigameTouch'; matchId: string; target: string; x: number; y: number }
```

Add to `ServerMsg`:

```ts
  | { t: 'minigameTouch'; touch: MinigameTouch }
```

In `shared/legality.ts` extend `Refusal` with `| 'unpicked' | 'team-too-small' | 'ink-cards'`. In `client/ui.ts` `REFUSAL_TEXT` add:

```ts
  'unpicked': 'Someone connected has not picked a team yet.',
  'team-too-small': 'Each team needs at least two players.',
  'ink-cards': 'Phantom Ink needs packs/phantom-ink.txt with at least 16 P: prompts and one W: word card.',
```

- [ ] **Step 2: Write the failing lobby tests**

`server/minigames/lobby.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLobby, lobbyStartable, teamMembers } from './lobby.ts'
import type { MinigameLobby } from '../../shared/protocol.ts'

const empty = (): MinigameLobby => ({ teams: {}, volunteers: [] })

test('joining, switching and leaving update the team and drop the volunteer mark', () => {
  const lobby = empty()
  assert.equal(applyLobby(lobby, 'ada', { do: 'join', team: 'sun' }), true)
  assert.equal(applyLobby(lobby, 'ada', { do: 'join', team: 'sun' }), false)
  assert.equal(applyLobby(lobby, 'ada', { do: 'volunteer', on: true }), true)
  assert.deepEqual(lobby.volunteers, ['ada'])
  applyLobby(lobby, 'ada', { do: 'join', team: 'moon' })
  assert.equal(lobby.teams.ada, 'moon')
  assert.deepEqual(lobby.volunteers, [])
  applyLobby(lobby, 'ada', { do: 'leave' })
  assert.equal(lobby.teams.ada, undefined)
})

test('volunteering needs a team', () => {
  const lobby = empty()
  assert.equal(applyLobby(lobby, 'ada', { do: 'volunteer', on: true }), false)
  assert.deepEqual(lobby.volunteers, [])
})

test('start needs every connected player picked and two per team', () => {
  const lobby = empty()
  const connected = ['a', 'b', 'c', 'd']
  applyLobby(lobby, 'a', { do: 'join', team: 'sun' })
  applyLobby(lobby, 'b', { do: 'join', team: 'sun' })
  applyLobby(lobby, 'c', { do: 'join', team: 'moon' })
  assert.equal(lobbyStartable(lobby, connected), 'unpicked')
  applyLobby(lobby, 'd', { do: 'join', team: 'sun' })
  assert.equal(lobbyStartable(lobby, connected), 'team-too-small')
  applyLobby(lobby, 'd', { do: 'join', team: 'moon' })
  assert.equal(lobbyStartable(lobby, connected), null)
})

test('disconnected picks do not count toward a team', () => {
  const lobby = empty()
  for (const [id, team] of [['a', 'sun'], ['b', 'sun'], ['c', 'moon'], ['gone', 'moon']] as const) {
    applyLobby(lobby, id, { do: 'join', team })
  }
  assert.deepEqual(teamMembers(lobby, ['a', 'b', 'c'], 'moon'), ['c'])
  assert.equal(lobbyStartable(lobby, ['a', 'b', 'c']), 'team-too-small')
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test server/minigames/lobby.test.ts`
Expected: FAIL, cannot find module `./lobby.ts`.

- [ ] **Step 4: Implement `server/minigames/lobby.ts`**

```ts
import type { InkTeamName, LobbyChange, MinigameLobby, PlayerId } from '../../shared/protocol.ts'
import type { Refusal } from '../../shared/legality.ts'

/** Returns whether the lobby changed. */
export function applyLobby(lobby: MinigameLobby, playerId: PlayerId, change: LobbyChange): boolean {
  const team = lobby.teams[playerId]
  const volunteering = lobby.volunteers.includes(playerId)
  const unvolunteer = () => { lobby.volunteers = lobby.volunteers.filter((id) => id !== playerId) }
  if (change.do === 'join') {
    if (change.team !== 'sun' && change.team !== 'moon') return false
    if (team === change.team) return false
    lobby.teams[playerId] = change.team
    unvolunteer()
    return true
  }
  if (change.do === 'leave') {
    if (!team) return false
    delete lobby.teams[playerId]
    unvolunteer()
    return true
  }
  if (change.do === 'volunteer') {
    if (!team || change.on === volunteering) return false
    if (change.on) lobby.volunteers.push(playerId)
    else unvolunteer()
    return true
  }
  return false
}

export function teamMembers(lobby: MinigameLobby, connected: PlayerId[], team: InkTeamName): PlayerId[] {
  return connected.filter((id) => lobby.teams[id] === team)
}

export function lobbyStartable(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null {
  if (connected.some((id) => !lobby.teams[id])) return 'unpicked'
  if (teamMembers(lobby, connected, 'sun').length < 2 || teamMembers(lobby, connected, 'moon').length < 2) return 'team-too-small'
  return null
}
```

- [ ] **Step 5: Run lobby tests**

Run: `node --test server/minigames/lobby.test.ts`
Expected: PASS.

- [ ] **Step 6: Extend the definition type**

In `server/minigames/definition.ts`, import `MinigameLobby`, `PlayerId` from protocol and `Refusal` from `../../shared/legality.ts`, then:

```ts
export type TouchAudience = { players: PlayerId[]; board: boolean }
```

In `MinigameDefinition<W>` change `create` and add optional members:

```ts
  create(seed: number, participants: string[], options: Record<string, number>, lobby: MinigameLobby): { world: W; crews?: TankCrew[] }
  /** No clock: the match ends when `finished` returns true. */
  untimed?: true
  finished?(world: W): boolean
  /** Checked on prepare and again on start; a reason refuses the host action. */
  prepare?(): Refusal | null
  startable?(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null
  /** Who sees a player's touch. Null drops it. */
  touchAudience?(world: W, playerId: PlayerId, target: string): TouchAudience | null
```

- [ ] **Step 7: Write the failing runtime tests**

Append to `server/minigames/runtime.test.ts` (add `import { MINIGAMES } from './registry.ts'` and `import type { MinigameDefinition } from './definition.ts'` at the top):

```ts
type Toy = { tick: number; done: boolean; lobby: unknown }

function withToy(run: (toy: MinigameDefinition<Toy>) => void, refusal: 'ink-cards' | null = null) {
  const toy: MinigameDefinition<Toy> = {
    stepMs: 50,
    untimed: true,
    options: () => ({}),
    prepare: () => refusal,
    startable: (lobby, connected) => connected.every((id) => lobby.teams[id]) ? null : 'unpicked',
    create: (_seed, _participants, _options, lobby) => ({ world: { tick: 0, done: false, lobby } }),
    finished: (world) => world.done,
    classify: (input) => (input as { kind?: string })?.kind === 'finish' ? 'discrete' : null,
    apply: (world) => { world.done = true; return { status: 'accepted' } },
    step: (world) => { world.tick++ },
    tick: (world) => world.tick,
    boardFrame: () => ({}),
    playerFrame: () => ({}),
    results: () => [{ playerId: 'ada', points: 1, shots: 0 }],
    touchAudience: (_world, playerId, target) => ({ players: [playerId], board: target.startsWith('row:') }),
  }
  const registry = MINIGAMES as Record<string, MinigameDefinition<any>>
  registry.toy = toy
  try { run(toy) } finally { delete registry.toy }
}

const prepareToy = (r: ReturnType<typeof rig>) =>
  r.runtime.host({ a: 'prepareMinigame', id: 'toy' as never, options: {} })

test('prepare refuses with the definition reason and creates an empty lobby otherwise', () => {
  withToy(() => {
    const r = rig()
    assert.deepEqual(prepareToy(r), { status: 'refused', reason: 'ink-cards' })
    assert.equal(r.state.minigame, undefined)
  }, 'ink-cards')
  withToy(() => {
    const r = rig()
    assert.deepEqual(prepareToy(r), { status: 'applied' })
    assert.deepEqual(r.state.minigame?.lobby, { teams: {}, volunteers: [] })
  })
})

test('lobby changes apply only while ready and start checks the lobby', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    assert.deepEqual(r.runtime.host({ a: 'startMinigame' }), { status: 'refused', reason: 'unpicked' })
    assert.equal(r.runtime.lobby('ada', { do: 'join', team: 'sun' }), true)
    assert.equal(r.runtime.lobby('bo', { do: 'join', team: 'moon' }), true)
    assert.equal(r.runtime.lobby('nobody', { do: 'join', team: 'moon' }), false)
    assert.deepEqual(r.runtime.host({ a: 'startMinigame' }), { status: 'applied' })
    assert.equal(r.runtime.lobby('ada', { do: 'leave' }), false)
    assert.equal(r.state.minigame?.endsAt, undefined)
  })
})

test('an untimed match runs past any duration and completes when finished', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.setNow(r.state.minigame!.startsAt!)
    r.runtime.pump()
    r.advance(600_000)
    assert.equal(r.completions.length, 0)
    const matchId = r.state.minigame!.matchId
    r.runtime.input('ada', { t: 'minigameInput', matchId, seq: 1, input: { kind: 'finish', at: r.state.minigame!.startsAt! } as never })
    r.advance(60)
    assert.equal(r.completions.length, 1)
  })
})

test('touches reach the audience the definition names, only while playing', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    const touch = (target: string) => ({ t: 'minigameTouch' as const, matchId: r.state.minigame!.matchId, target, x: 0.5, y: 0.5 })
    assert.equal(r.runtime.touch('ada', touch('row:sun:0')), null)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.setNow(r.state.minigame!.startsAt!)
    r.runtime.pump()
    assert.deepEqual(r.runtime.touch('ada', touch('row:sun:0')), { players: ['ada'], board: true })
    assert.equal(r.runtime.touch('ada', { ...touch('card:1'), x: 2 }), null)
    assert.equal(r.runtime.touch('ada', { ...touch('card:1'), matchId: 'old' }), null)
  })
})

test('cancel keeps the lobby and close removes it', () => {
  withToy(() => {
    const r = rig()
    prepareToy(r)
    r.runtime.lobby('ada', { do: 'join', team: 'sun' })
    r.runtime.lobby('bo', { do: 'join', team: 'moon' })
    r.runtime.host({ a: 'startMinigame' })
    r.runtime.host({ a: 'cancelMinigame' })
    assert.deepEqual(r.state.minigame?.lobby?.teams, { ada: 'sun', bo: 'moon' })
    r.runtime.host({ a: 'closeMinigame' })
    assert.equal(r.state.minigame, undefined)
  })
})
```

- [ ] **Step 8: Run to verify failure**

Run: `node --test server/minigames/runtime.test.ts`
Expected: FAIL (`runtime.lobby is not a function`, prepare applies despite refusal).

- [ ] **Step 9: Implement runtime changes**

In `server/minigames/runtime.ts`:

Imports: add `LobbyChange`, `MinigameLobby` from protocol; `applyLobby` from `./lobby.ts`; `TouchAudience` from `./definition.ts`.

Prepare branch, after the unknown-mode check:

```ts
      const refusal = MINIGAMES[action.id].prepare?.()
      if (refusal) return { status: 'refused', reason: refusal }
```

and add `lobby: { teams: {}, volunteers: [] }` to the new `state.minigame` object.

Start branch, after the `no-players` check:

```ts
      const lobby: MinigameLobby = session.lobby ?? { teams: {}, volunteers: [] }
      const refusal = definition.prepare?.() ?? definition.startable?.(lobby, participants)
      if (refusal) return { status: 'refused', reason: refusal }
```

Replace the `endsAt` line with:

```ts
      session.endsAt = definition.untimed ? undefined : startsAt + session.options.durationSec * 1_000
```

and pass `lobby` as the fourth `create` argument.

In `input`, replace the discrete window checks with:

```ts
    if (session.phase !== 'playing') return refuse('not-playing')
    if (!this.definition()?.untimed && (arrival > (session.endsAt ?? 0) + INPUT_GRACE_MS || Math.min(arrival, Math.max(session.startsAt ?? 0, at)) > (session.endsAt ?? 0))) {
      return refuse('not-playing')
    }
```

In `pump`, replace the guard and the time bound:

```ts
    if (!session || !definition || !this.world || !session.startsAt) return
    if (!definition.untimed && !session.endsAt) return
```

```ts
    const until = definition.untimed ? now : Math.min(now, session.endsAt! + LANDING_GRACE_MS)
```

and the completion check:

```ts
    const over = definition.untimed ? definition.finished?.(this.world) === true : now >= session.endsAt! + LANDING_GRACE_MS
    if (!this.completed && over) {
```

Add methods:

```ts
  /** Team picks during ready. Returns whether the lobby changed. */
  lobby(playerId: string, change: LobbyChange): boolean {
    const session = this.state.minigame
    if (!session?.lobby || session.phase !== 'ready') return false
    if (!this.state.players.some((player) => player.id === playerId)) return false
    return applyLobby(session.lobby, playerId, change)
  }

  /** Validates a touch and names who should see it. */
  touch(playerId: string, msg: { matchId: string; target: string; x: number; y: number }): TouchAudience | null {
    const session = this.state.minigame
    const definition = this.definition()
    if (!session || !definition?.touchAudience || !this.world) return null
    if (session.phase !== 'playing' || msg.matchId !== session.matchId) return null
    if (typeof msg.target !== 'string' || msg.target.length > 40) return null
    const inside = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1
    if (!inside(msg.x) || !inside(msg.y)) return null
    return definition.touchAudience(this.world, playerId, msg.target)
  }
```

- [ ] **Step 10: Run runtime tests**

Run: `node --test server/minigames/runtime.test.ts`
Expected: PASS, including the existing bow and tank tests.

- [ ] **Step 11: Write the failing hub relay test**

Append to `server/hub.test.ts` (add imports `MinigameRuntime` from `./minigames/runtime.ts`):

```ts
test('lobby picks broadcast state and touches reach only the named audience', () => {
  const { state, hub, conn, lastState } = rig()
  const runtime = new MinigameRuntime(state, {
    onState: (cause) => hub.minigameChanged(cause), onFrame: () => {}, onAck: () => {}, onComplete: () => {},
  })
  hub.setMinigameRuntime(runtime)
  const board = conn('board')
  const ada = conn('player')
  const bo = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, bo, 'Bo')
  state.minigame = { id: 'bow', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [], lobby: { teams: {}, volunteers: [] } }
  hub.handle(ada, { t: 'minigameLobby', change: { do: 'join', team: 'sun' } })
  assert.equal(lastState(1).minigame?.lobby?.teams[ada.playerId!], 'sun')

  const sentTo = (c: typeof ada) => {
    const msgs: unknown[] = []
    c.send = (m) => { msgs.push(m) }
    return msgs
  }
  const boardMsgs = sentTo(board)
  const adaMsgs = sentTo(ada)
  const boMsgs = sentTo(bo)
  runtime.touch = () => ({ players: [ada.playerId!], board: true })
  hub.handle(ada, { t: 'minigameTouch', matchId: 'm', target: 'row:sun:0', x: 0.1, y: 0.2 })
  const expected = { t: 'minigameTouch', touch: { playerId: ada.playerId, name: 'Ada', target: 'row:sun:0', x: 0.1, y: 0.2 } }
  assert.deepEqual(boardMsgs, [expected])
  assert.deepEqual(adaMsgs, [expected])
  assert.deepEqual(boMsgs, [])
})
```

- [ ] **Step 12: Run to verify failure**

Run: `node --test server/hub.test.ts`
Expected: FAIL (lobby unchanged; no touch messages).

- [ ] **Step 13: Route the messages in `Hub.handle`**

```ts
      case 'minigameLobby':
        if (conn.role === 'player' && conn.playerId && this.minigame?.lobby(conn.playerId, msg.change)) {
          this.changed('minigame:lobby')
        }
        return

      case 'minigameTouch': {
        if (conn.role !== 'player' || !conn.playerId || !this.minigame) return
        const audience = this.minigame.touch(conn.playerId, msg)
        if (!audience) return
        const name = this.state.players.find((player) => player.id === conn.playerId)?.name ?? '?'
        const out: ServerMsg = { t: 'minigameTouch', touch: { playerId: conn.playerId, name, target: msg.target, x: msg.x, y: msg.y } }
        for (const other of this.conns) {
          const wanted = other.role === 'board'
            ? audience.board
            : other.role === 'player' && !!other.playerId && audience.players.includes(other.playerId)
          if (wanted) other.send(out)
        }
        return
      }
```

Import `ServerMsg` from protocol if not already imported. Lobby edits are not undo steps and do not touch `history`.

- [ ] **Step 14: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS. Bow and tank `create` implementations ignore the new fourth parameter.

- [ ] **Step 15: Commit**

```bash
git add shared server client/ui.ts
git commit -m "feat: untimed minigames, ready lobby and touch relay"
```

---

### Task 2: Card file parsing

**Files:**
- Create: `server/minigames/ink/cards.ts`, `server/minigames/ink/cards.test.ts`

**Interfaces:**
- Produces:
  - `type InkCards = { prompts: string[]; words: string[][] }`
  - `parseInkCards(text: string): InkCards | string` (string = error message)
  - `loadInkCards(path: string): InkCards | string`
  - `INK_CARDS_PATH: string`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadInkCards, parseInkCards } from './cards.ts'

const prompts = (n: number) => Array.from({ length: n }, (_, i) => `P: Prompt ${i}?`).join('\n')

test('parses prompts and six-word cards, skipping blanks and comments', () => {
  const cards = parseInkCards(`# mine\n${prompts(16)}\n\nW: Apple | Calendar | Snowman | Chili | Fox | Table\n`)
  assert.equal(typeof cards, 'object')
  if (typeof cards === 'string') return
  assert.equal(cards.prompts.length, 16)
  assert.equal(cards.prompts[0], 'Prompt 0?')
  assert.deepEqual(cards.words, [['Apple', 'Calendar', 'Snowman', 'Chili', 'Fox', 'Table']])
})

test('reports the line of a malformed entry', () => {
  assert.equal(parseInkCards(`${prompts(16)}\nW: One | Two`), 'Line 17: a word card needs 6 words')
  assert.equal(parseInkCards(`${prompts(16)}\nhello`), 'Line 17: start the line with P: or W:')
})

test('needs 16 prompts and a word card', () => {
  assert.equal(parseInkCards(`${prompts(15)}\nW: a|b|c|d|e|f`), 'At least 16 prompts are needed')
  assert.equal(parseInkCards(prompts(16)), 'At least one word card is needed')
})

test('a missing file is an error message', () => {
  assert.equal(loadInkCards('/nonexistent/phantom-ink.txt'), 'packs/phantom-ink.txt is missing')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test server/minigames/ink/cards.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `cards.ts`**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type InkCards = { prompts: string[]; words: string[][] }

/** Transcribed from the owner's cards; gitignored. */
export const INK_CARDS_PATH = fileURLToPath(new URL('../../../packs/phantom-ink.txt', import.meta.url))

export function parseInkCards(text: string): InkCards | string {
  const cards: InkCards = { prompts: [], words: [] }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('P:')) cards.prompts.push(line.slice(2).trim())
    else if (line.startsWith('W:')) {
      const words = line.slice(2).split('|').map((word) => word.trim()).filter(Boolean)
      if (words.length !== 6) return `Line ${i + 1}: a word card needs 6 words`
      cards.words.push(words)
    } else return `Line ${i + 1}: start the line with P: or W:`
  }
  if (cards.prompts.length < 16) return 'At least 16 prompts are needed'
  if (cards.words.length === 0) return 'At least one word card is needed'
  return cards
}

export function loadInkCards(path: string): InkCards | string {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return 'packs/phantom-ink.txt is missing'
  }
  return parseInkCards(text)
}
```

- [ ] **Step 4: Run tests**

Run: `node --test server/minigames/ink/cards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/minigames/ink/cards.ts server/minigames/ink/cards.test.ts
git commit -m "feat: ink card file parsing"
```

---

### Task 3: Ink world — setup, secret word and votes

**Files:**
- Create: `server/minigames/ink/types.ts`, `server/minigames/ink/world.ts`, `server/minigames/ink/world.test.ts`, `server/minigames/ink/fixtures.ts`
- Modify: `shared/protocol.ts` (add `InkPoint`, `InkInput`)

**Interfaces:**
- Consumes: `InkCards` (Task 2), `InkTeamName` (Task 1), `mulberry32` from `server/minigames/bow/world.ts` (tests only).
- Produces (used by Tasks 4–6):
  - `createInkWorld(input: { rand: () => number; cards: InkCards; lobby: MinigameLobby; participants: PlayerId[] }): InkWorld`
  - `applyInk(world: InkWorld, playerId: PlayerId, input: InkInput): Outcome`
  - `roleOf(world, playerId): { team: InkTeamName; role: 'writer' | 'guesser' } | null`
  - `leadingChoice(votes: InkVote[]): string | null`
  - `validPoints(points: unknown): points is InkPoint[]`
  - `inkTarget(world, playerId): { team: InkTeamName; row: number; peek: boolean } | null`
  - `peekTargets(world): string[]` (entries like `'sun:2'`, 0-based row)
  - `inkResults(world): MinigameResult[]`

- [ ] **Step 1: Protocol types**

In `shared/protocol.ts`:

```ts
export type InkPoint = [number, number]

export type InkInput =
  | { kind: 'pickWord'; index: number; at: number }
  /** An empty choice clears the vote. */
  | { kind: 'vote'; choice: string; at: number }
  | { kind: 'force'; at: number }
  | { kind: 'keep'; prompt: number; at: number }
  /** The stroke in progress, repeated while drawing. */
  | { kind: 'ink'; points: InkPoint[] }
  | { kind: 'stroke'; points: InkPoint[]; at: number }
  | { kind: 'undo'; at: number }
  | { kind: 'stop'; at: number }
  | { kind: 'done'; at: number }
  | { kind: 'endClue'; at: number }
  | { kind: 'check'; at: number }
  | { kind: 'judge'; correct: boolean; at: number }
  | { kind: 'finishGuess'; at: number }
  | { kind: 'verdict'; win: boolean; at: number }
```

Widen `MinigameInputMsg['input']` to `BowInput | TankInput | InkInput`.

- [ ] **Step 2: Create `types.ts`**

```ts
import type { InkPoint, InkTeamName, PlayerId } from '../../../shared/protocol.ts'
import type { InputOutcome } from '../definition.ts'
import type { InkCards } from './cards.ts'

export const INK_ROWS = 8
export const HAND_SIZE = 7
export const ASK_DRAW = 2
/** 1-based rows with the peek mark. */
export const PEEK_ROWS: Record<InkTeamName, number[]> = { sun: [4, 6, 7], moon: [3, 5, 6] }
export const TEAMS: InkTeamName[] = ['sun', 'moon']

export type Outcome = InputOutcome

export type InkStroke = { points: InkPoint[]; author: PlayerId; peek?: true }

export type InkRow = {
  kind: 'clue' | 'guess' | null
  strokes: InkStroke[]
  /** Inclusive stroke index ranges drawn struck through. */
  strikes: [number, number][]
  /** A period follows the last stroke. */
  ended: boolean
  won?: true
}

export type InkStep =
  | { at: 'choosing' }
  | { at: 'peekPick' }
  | { at: 'peekWrite'; team: InkTeamName; row: number; from: number }
  | { at: 'choose' }
  | { at: 'offer' }
  | { at: 'keep'; offered: [number, number] }
  | { at: 'clue'; prompt: number; stopped: boolean }
  | { at: 'guess'; holder: PlayerId | null }
  | { at: 'judgeLetter' }
  | { at: 'judgeWord' }
  | { at: 'over'; winner: InkTeamName | null }

export type InkVote = { player: PlayerId; choice: string; seq: number }

export type InkWorld = {
  rand: () => number
  tick: number
  cards: InkCards
  roster: Record<InkTeamName, { writer: PlayerId; guessers: PlayerId[] }>
  deck: number[]
  discard: number[]
  hands: Record<InkTeamName, number[]>
  asked: Record<InkTeamName, number[]>
  redrawn: Record<InkTeamName, boolean>
  wordCard: string[]
  picks: Partial<Record<InkTeamName, number>>
  secret: string | null
  pad: Record<InkTeamName, InkRow[]>
  padVersion: number
  sentVersion: number
  nextPadTick: number
  turn: InkTeamName
  /** The turn team's row for this turn. */
  row: number
  step: InkStep
  votes: InkVote[]
  voteSeq: number
  live: Record<PlayerId, InkPoint[]>
  undoable: { team: InkTeamName; row: number; player: PlayerId } | null
  /** Strokes in the guess row already judged. */
  checked: number
}
```

- [ ] **Step 3: Write the failing setup and vote tests**

`server/minigames/ink/fixtures.ts` (shared by the ink tests; not a test file, so importing it runs no tests):

```ts
import type { InkCards } from './cards.ts'

export const CARDS: InkCards = {
  prompts: Array.from({ length: 20 }, (_, i) => `Prompt ${i}`),
  words: [['Apple', 'Calendar', 'Snowman', 'Chili', 'Fox', 'Table']],
}
```

`server/minigames/ink/world.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import type { InkInput } from '../../../shared/protocol.ts'
import { CARDS } from './fixtures.ts'
import { applyInk, createInkWorld, inkFinished, inkResults, leadingChoice, peekTargets, roleOf } from './world.ts'
import type { InkWorld } from './types.ts'

/** Sun: sw writes, s1 s2 guess. Moon: mw writes, m1 guesses. */
function world(): InkWorld {
  return createInkWorld({
    rand: mulberry32(1),
    cards: CARDS,
    participants: ['m1', 'mw', 's1', 's2', 'sw'],
    lobby: { teams: { sw: 'sun', s1: 'sun', s2: 'sun', mw: 'moon', m1: 'moon' }, volunteers: ['sw', 'mw'] },
  })
}

let at = 0
const act = (w: InkWorld, player: string, input: Record<string, unknown>) =>
  applyInk(w, player, { at: ++at, ...input } as InkInput)

function started(): InkWorld {
  const w = world()
  act(w, 'sw', { kind: 'pickWord', index: 2 })
  act(w, 'mw', { kind: 'pickWord', index: 2 })
  return w
}

test('volunteers write, everyone else guesses, and each team holds seven prompts', () => {
  const w = world()
  assert.deepEqual(w.roster, { sun: { writer: 'sw', guessers: ['s1', 's2'] }, moon: { writer: 'mw', guessers: ['m1'] } })
  assert.equal(w.hands.sun.length, 7)
  assert.equal(w.hands.moon.length, 7)
  assert.equal(w.deck.length, 6)
  assert.equal(w.wordCard.length, 6)
  assert.deepEqual(roleOf(w, 's1'), { team: 'sun', role: 'guesser' })
  assert.equal(roleOf(w, 'stranger'), null)
})

test('without volunteers a team member is drawn as writer', () => {
  const w = createInkWorld({
    rand: mulberry32(3), cards: CARDS, participants: ['a', 'b', 'c', 'd'],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'moon', d: 'moon' }, volunteers: [] },
  })
  assert.ok(['a', 'b'].includes(w.roster.sun.writer))
  assert.equal(w.roster.sun.guessers.length, 1)
})

test('the secret word locks once both writers pick the same word', () => {
  const w = world()
  assert.deepEqual(act(w, 's1', { kind: 'pickWord', index: 1 }), { status: 'refused', reason: 'not-allowed' })
  act(w, 'sw', { kind: 'pickWord', index: 1 })
  act(w, 'mw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, null)
  act(w, 'sw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, 'Chili')
  assert.equal(w.turn, 'sun')
  assert.deepEqual(w.step, { at: 'choose' })
})

test('a vote applies when every guesser agrees', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'guess' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'offer' })
  assert.deepEqual(w.votes, [])
})

test('the other team and the writer cannot vote; invalid choices are refused', () => {
  const w = started()
  assert.equal(act(w, 'm1', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 'sw', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'fly' }).status, 'refused')
})

test('force applies the leading choice, earliest to reach the count on a tie', () => {
  assert.equal(leadingChoice([]), null)
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
  ]), 'guess')
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
    { player: 'c', choice: 'ask', seq: 3 },
  ]), 'ask')
  const w = started()
  assert.equal(act(w, 's1', { kind: 'force' }).status, 'refused')
  act(w, 's1', { kind: 'vote', choice: 'guess' })
  act(w, 's2', { kind: 'force' })
  assert.equal(w.step.at, 'guess')
})

test('prompt pairs match regardless of order', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  act(w, 's1', { kind: 'vote', choice: `${w.hands.sun[0]},${w.hands.sun[1]}` })
  act(w, 's2', { kind: 'vote', choice: `${w.hands.sun[1]},${w.hands.sun[0]}` })
  assert.equal(w.step.at, 'keep')
})
```

Moon has one Guesser, so Tasks 4 and 5 cover a single Guesser deciding at once through Moon's turns.

- [ ] **Step 4: Run to verify failure**

Run: `node --test server/minigames/ink/world.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 5: Implement `world.ts` (setup, votes, all steps)**

Write the whole rules module now; Tasks 4 and 5 add tests against it and fix what they find.

```ts
import type { InkInput, InkPoint, InkTeamName, MinigameLobby, MinigameResult, PlayerId } from '../../../shared/protocol.ts'
import type { InkCards } from './cards.ts'
import {
  ASK_DRAW, HAND_SIZE, INK_ROWS, PEEK_ROWS, TEAMS,
  type InkRow, type InkVote, type InkWorld, type Outcome,
} from './types.ts'

const OK: Outcome = { status: 'accepted' }
const NO: Outcome = { status: 'refused', reason: 'not-allowed' }
const MAX_POINTS = 500

export const otherTeam = (team: InkTeamName): InkTeamName => team === 'sun' ? 'moon' : 'sun'

function shuffle<T>(rand: () => number, items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const emptyRow = (): InkRow => ({ kind: null, strokes: [], strikes: [], ended: false })

export function createInkWorld(input: {
  rand: () => number
  cards: InkCards
  lobby: MinigameLobby
  participants: PlayerId[]
}): InkWorld {
  const { rand, cards, lobby, participants } = input
  const roster = {} as InkWorld['roster']
  for (const team of TEAMS) {
    const members = participants.filter((id) => lobby.teams[id] === team)
    const volunteers = members.filter((id) => lobby.volunteers.includes(id))
    const pool = volunteers.length ? volunteers : members
    const writer = pool[Math.floor(rand() * pool.length)]
    roster[team] = { writer, guessers: members.filter((id) => id !== writer) }
  }
  const w: InkWorld = {
    rand, tick: 0, cards, roster,
    deck: shuffle(rand, cards.prompts.map((_, i) => i)),
    discard: [],
    hands: { sun: [], moon: [] },
    asked: { sun: [], moon: [] },
    redrawn: { sun: false, moon: false },
    wordCard: cards.words[Math.floor(rand() * cards.words.length)],
    picks: {},
    secret: null,
    pad: { sun: Array.from({ length: INK_ROWS }, emptyRow), moon: Array.from({ length: INK_ROWS }, emptyRow) },
    padVersion: 0, sentVersion: -1, nextPadTick: 0,
    turn: 'sun', row: 0,
    step: { at: 'choosing' },
    votes: [], voteSeq: 0, live: {}, undoable: null, checked: 0,
  }
  for (const team of TEAMS) draw(w, team, HAND_SIZE)
  return w
}

export function roleOf(w: InkWorld, playerId: PlayerId): { team: InkTeamName; role: 'writer' | 'guesser' } | null {
  for (const team of TEAMS) {
    if (w.roster[team].writer === playerId) return { team, role: 'writer' }
    if (w.roster[team].guessers.includes(playerId)) return { team, role: 'guesser' }
  }
  return null
}

function draw(w: InkWorld, team: InkTeamName, count: number): void {
  for (let i = 0; i < count; i++) {
    if (w.deck.length === 0) {
      w.deck = shuffle(w.rand, w.discard)
      w.discard = []
    }
    const card = w.deck.pop()
    if (card === undefined) return
    w.hands[team].push(card)
  }
}

const bump = (w: InkWorld) => { w.padVersion++ }

export function peekTargets(w: InkWorld): string[] {
  const out: string[] = []
  for (const team of TEAMS) {
    w.pad[team].forEach((row, i) => {
      if (row.kind === 'clue' && !row.ended && row.strokes.length > 0) out.push(`${team}:${i}`)
    })
  }
  return out
}

function beginTurn(w: InkWorld, team: InkTeamName): void {
  w.turn = team
  w.votes = []
  w.live = {}
  w.undoable = null
  const row = w.pad[team].findIndex((r) => r.kind === null)
  if (row < 0) {
    w.step = { at: 'over', winner: null }
    return
  }
  w.row = row
  w.step = PEEK_ROWS[team].includes(row + 1) && peekTargets(w).length > 0 ? { at: 'peekPick' } : { at: 'choose' }
}

const endTurn = (w: InkWorld) => beginTurn(w, otherTeam(w.turn))
const turnRow = (w: InkWorld) => w.pad[w.turn][w.row]

export function leadingChoice(votes: InkVote[]): string | null {
  const tally = new Map<string, { count: number; reached: number }>()
  for (const vote of votes) {
    const entry = tally.get(vote.choice) ?? { count: 0, reached: 0 }
    entry.count++
    entry.reached = Math.max(entry.reached, vote.seq)
    tally.set(vote.choice, entry)
  }
  let best: string | null = null
  let top = { count: 0, reached: Infinity }
  for (const [choice, entry] of tally) {
    if (entry.count > top.count || (entry.count === top.count && entry.reached < top.reached)) {
      best = choice
      top = entry
    }
  }
  return best
}

function promptPair(w: InkWorld, choice: string): [number, number] | null {
  const parts = choice.split(',').map(Number)
  if (parts.length !== 2 || parts[0] === parts[1]) return null
  if (!parts.every((id) => w.hands[w.turn].includes(id))) return null
  return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])]
}

function validChoice(w: InkWorld, choice: string): boolean {
  if (w.step.at === 'choose') return choice === 'ask' || choice === 'guess' || (choice === 'redraw' && !w.redrawn[w.turn])
  if (w.step.at === 'offer') return promptPair(w, choice) !== null
  if (w.step.at === 'peekPick') return peekTargets(w).includes(choice)
  return false
}

/** Prompt pairs compare as sets. */
const normalize = (w: InkWorld, choice: string) =>
  w.step.at === 'offer' ? promptPair(w, choice)?.join(',') ?? choice : choice

function resolve(w: InkWorld, choice: string): void {
  w.votes = []
  const team = w.turn
  if (w.step.at === 'choose') {
    if (choice === 'ask') w.step = { at: 'offer' }
    else if (choice === 'guess') {
      turnRow(w).kind = 'guess'
      w.checked = 0
      w.step = { at: 'guess', holder: null }
      bump(w)
    } else {
      w.discard.push(...w.hands[team])
      w.hands[team] = []
      draw(w, team, HAND_SIZE)
      w.redrawn[team] = true
    }
  } else if (w.step.at === 'offer') {
    const pair = promptPair(w, choice)!
    w.hands[team] = w.hands[team].filter((id) => !pair.includes(id))
    w.step = { at: 'keep', offered: pair }
  } else if (w.step.at === 'peekPick') {
    const [rowTeam, index] = choice.split(':') as [InkTeamName, string]
    const row = Number(index)
    w.step = { at: 'peekWrite', team: rowTeam, row, from: w.pad[rowTeam][row].strokes.length }
  }
}

export function validPoints(points: unknown): points is InkPoint[] {
  return Array.isArray(points) && points.length > 0 && points.length <= MAX_POINTS && points.every((p) =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= 0 && n <= 1))
}

const quantize = (points: InkPoint[]): InkPoint[] =>
  points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])

export function inkTarget(w: InkWorld, playerId: PlayerId): { team: InkTeamName; row: number; peek: boolean } | null {
  const s = w.step
  const role = roleOf(w, playerId)
  if (!role) return null
  if (s.at === 'clue' && role.role === 'writer' && role.team === w.turn) return { team: w.turn, row: w.row, peek: false }
  if (s.at === 'peekWrite' && w.roster[s.team].writer === playerId) return { team: s.team, row: s.row, peek: true }
  if (s.at === 'guess' && role.role === 'guesser' && role.team === w.turn && (s.holder === null || s.holder === playerId)) {
    return { team: w.turn, row: w.row, peek: false }
  }
  return null
}

function finishClue(w: InkWorld, ended: boolean): void {
  if (w.step.at !== 'clue') return
  turnRow(w).ended = ended
  w.asked[w.turn].push(w.step.prompt)
  draw(w, w.turn, ASK_DRAW)
  bump(w)
  endTurn(w)
}

export function applyInk(w: InkWorld, playerId: PlayerId, input: InkInput): Outcome {
  const role = roleOf(w, playerId)
  if (!role) return NO
  const s = w.step
  const turnGuesser = role.role === 'guesser' && role.team === w.turn
  const turnWriter = role.role === 'writer' && role.team === w.turn

  switch (input.kind) {
    case 'pickWord': {
      if (s.at !== 'choosing' || role.role !== 'writer') return NO
      if (!Number.isInteger(input.index) || input.index < 0 || input.index >= w.wordCard.length) return NO
      w.picks[role.team] = input.index
      if (w.picks.sun !== undefined && w.picks.sun === w.picks.moon) {
        w.secret = w.wordCard[input.index]
        beginTurn(w, 'sun')
      }
      return OK
    }
    case 'vote': {
      if (!turnGuesser || typeof input.choice !== 'string') return NO
      if (input.choice && !validChoice(w, input.choice)) return NO
      const choice = normalize(w, input.choice)
      w.votes = w.votes.filter((vote) => vote.player !== playerId)
      if (!choice) return OK
      w.votes.push({ player: playerId, choice, seq: ++w.voteSeq })
      const guessers = w.roster[w.turn].guessers
      if (guessers.every((id) => w.votes.some((vote) => vote.player === id && vote.choice === choice))) resolve(w, choice)
      return OK
    }
    case 'force': {
      if (!turnGuesser) return NO
      const choice = leadingChoice(w.votes)
      if (!choice || !validChoice(w, choice)) return NO
      resolve(w, choice)
      return OK
    }
    case 'keep': {
      if (s.at !== 'keep' || !turnWriter || !s.offered.includes(input.prompt)) return NO
      w.discard.push(s.offered.find((id) => id !== input.prompt)!)
      turnRow(w).kind = 'clue'
      w.step = { at: 'clue', prompt: input.prompt, stopped: false }
      bump(w)
      return OK
    }
    case 'ink': {
      if (!inkTarget(w, playerId) || !validPoints(input.points)) return NO
      w.live[playerId] = quantize(input.points)
      return OK
    }
    case 'stroke': {
      const target = inkTarget(w, playerId)
      if (!target || !validPoints(input.points)) return NO
      const row = w.pad[target.team][target.row]
      row.strokes.push({ points: quantize(input.points), author: playerId, ...(target.peek ? { peek: true as const } : {}) })
      if (s.at === 'guess') s.holder = playerId
      w.undoable = { team: target.team, row: target.row, player: playerId }
      delete w.live[playerId]
      bump(w)
      return OK
    }
    case 'undo': {
      const u = w.undoable
      const target = inkTarget(w, playerId)
      if (!u || !target || u.player !== playerId || u.team !== target.team || u.row !== target.row) return NO
      const row = w.pad[u.team][u.row]
      row.strokes.pop()
      w.undoable = null
      if (s.at === 'guess' && row.strokes.length === w.checked) s.holder = null
      bump(w)
      return OK
    }
    case 'stop': {
      if (s.at !== 'clue' || !turnGuesser || s.stopped) return NO
      s.stopped = true
      return OK
    }
    case 'done': {
      if (s.at === 'clue' && turnWriter && s.stopped) {
        finishClue(w, false)
        return OK
      }
      if (s.at === 'peekWrite' && w.roster[s.team].writer === playerId && w.pad[s.team][s.row].strokes.length > s.from) {
        w.step = { at: 'choose' }
        w.votes = []
        w.undoable = null
        delete w.live[playerId]
        return OK
      }
      return NO
    }
    case 'endClue': {
      if (s.at !== 'clue' || !turnWriter) return NO
      finishClue(w, true)
      return OK
    }
    case 'check': {
      if (s.at !== 'guess' || !turnGuesser || turnRow(w).strokes.length <= w.checked) return NO
      w.step = { at: 'judgeLetter' }
      w.undoable = null
      w.live = {}
      return OK
    }
    case 'judge': {
      if (s.at !== 'judgeLetter' || !turnWriter) return NO
      const row = turnRow(w)
      if (input.correct) {
        w.checked = row.strokes.length
        w.step = { at: 'guess', holder: null }
      } else {
        row.strikes.push([w.checked, row.strokes.length - 1])
        bump(w)
        endTurn(w)
      }
      return OK
    }
    case 'finishGuess': {
      const row = turnRow(w)
      if (s.at !== 'guess' || !turnGuesser || w.checked === 0 || row.strokes.length !== w.checked) return NO
      row.ended = true
      w.step = { at: 'judgeWord' }
      w.undoable = null
      bump(w)
      return OK
    }
    case 'verdict': {
      if (s.at !== 'judgeWord' || !turnWriter) return NO
      if (input.win) {
        turnRow(w).won = true
        w.step = { at: 'over', winner: w.turn }
        bump(w)
      } else endTurn(w)
      return OK
    }
  }
  return NO
}

export const inkFinished = (w: InkWorld) => w.step.at === 'over'

export function inkResults(w: InkWorld): MinigameResult[] {
  if (w.step.at !== 'over' || !w.step.winner) return []
  const { writer, guessers } = w.roster[w.step.winner]
  return [writer, ...guessers].map((playerId) => ({ playerId, points: 1, shots: 0 }))
}
```

- [ ] **Step 6: Run tests**

Run: `node --test server/minigames/ink/world.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/protocol.ts server/minigames/ink
git commit -m "feat: ink world setup, secret word and team votes"
```

---

### Task 4: Ink world — asking, clues and the undo rule

**Files:**
- Test: `server/minigames/ink/world.test.ts`
- Modify (only if a test exposes a defect): `server/minigames/ink/world.ts`

**Interfaces:**
- Consumes: `world()`, `started()`, `act()` helpers from Task 3's test file.

- [ ] **Step 1: Write the tests**

Append:

```ts
const line: [number, number][] = [[0.1, 0.1], [0.2, 0.9]]

function askUntilClue(w: InkWorld, team: 'sun' | 'moon') {
  const guessers = w.roster[team].guessers
  for (const g of guessers) act(w, g, { kind: 'vote', choice: 'ask' })
  const pair = `${w.hands[team][0]},${w.hands[team][1]}`
  for (const g of guessers) act(w, g, { kind: 'vote', choice: pair })
  const step = w.step
  assert.equal(step.at, 'keep')
  if (step.at !== 'keep') throw new Error('not keep')
  act(w, w.roster[team].writer, { kind: 'keep', prompt: step.offered[0] })
  return step.offered
}

test('asking offers two prompts, keeps one and discards the other', () => {
  const w = started()
  const offered = askUntilClue(w, 'sun')
  assert.equal(w.hands.sun.length, 5)
  assert.deepEqual(w.discard, [offered[1]])
  assert.deepEqual(w.step, { at: 'clue', prompt: offered[0], stopped: false })
  assert.equal(w.pad.sun[0].kind, 'clue')
})

test('stop lets the writer finish the letter; done ends the clue and the turn', () => {
  const w = started()
  askUntilClue(w, 'sun')
  assert.equal(act(w, 'sw', { kind: 'done' }).status, 'refused')
  assert.equal(act(w, 's1', { kind: 'stroke', points: line }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's2', { kind: 'stop' })
  assert.equal(act(w, 'sw', { kind: 'stroke', points: line }).status, 'accepted')
  act(w, 'sw', { kind: 'done' })
  assert.equal(w.pad.sun[0].strokes.length, 2)
  assert.equal(w.pad.sun[0].ended, false)
  assert.equal(w.asked.sun.length, 1)
  assert.equal(w.hands.sun.length, 7)
  assert.equal(w.turn, 'moon')
  assert.deepEqual(w.step, { at: 'choose' })
})

test('end clue adds the period without a stop', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 'sw', { kind: 'endClue' })
  assert.equal(w.pad.sun[0].ended, true)
  assert.equal(w.turn, 'moon')
})

test('only the latest stroke can be undone, once', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 'sw', { kind: 'stroke', points: [[0.5, 0.5]] })
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'accepted')
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'refused')
  assert.equal(w.pad.sun[0].strokes.length, 1)
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'accepted')
  assert.equal(w.pad.sun[0].strokes.length, 1)
})

test('strokes are validated and rounded to three decimals', () => {
  const w = started()
  askUntilClue(w, 'sun')
  assert.equal(act(w, 'sw', { kind: 'stroke', points: [[1.2, 0]] }).status, 'refused')
  assert.equal(act(w, 'sw', { kind: 'stroke', points: [] }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: [[0.12345, 0.98765]] })
  assert.deepEqual(w.pad.sun[0].strokes[0].points, [[0.123, 0.988]])
})

test('the live stroke is kept for the writer and cleared on commit', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'ink', points: line })
  assert.deepEqual(w.live.sw, line)
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(w.live.sw, undefined)
  assert.equal(act(w, 'm1', { kind: 'ink', points: line }).status, 'refused')
})

test('the prompt deck reshuffles the discard pile when it runs out', () => {
  const w = started()
  w.discard.push(...w.deck)
  w.deck = []
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'endClue' })
  assert.equal(w.hands.sun.length, 7)
})
```

- [ ] **Step 2: Run tests**

Run: `node --test server/minigames/ink/world.test.ts`
Expected: PASS. If a test fails, fix `world.ts` (not the test) unless the test contradicts the spec.

- [ ] **Step 3: Commit**

```bash
git add server/minigames/ink
git commit -m "test: ink asking, clues and single-stroke undo"
```

---

### Task 5: Ink world — guessing, peek rows, redraw and the end

**Files:**
- Test: `server/minigames/ink/world.test.ts`
- Modify (only if a test exposes a defect): `server/minigames/ink/world.ts`

- [ ] **Step 1: Write the tests**

Append:

```ts
function voteAll(w: InkWorld, choice: string) {
  for (const g of w.roster[w.turn].guessers) act(w, g, { kind: 'vote', choice })
}

test('a guess is written letter by letter and judged by the writer', () => {
  const w = started()
  voteAll(w, 'guess')
  assert.equal(w.pad.sun[0].kind, 'guess')
  assert.equal(act(w, 's1', { kind: 'check' }).status, 'refused')
  act(w, 's1', { kind: 'stroke', points: line })
  assert.equal(act(w, 's2', { kind: 'stroke', points: line }).status, 'refused')
  act(w, 's1', { kind: 'check' })
  assert.equal(act(w, 'mw', { kind: 'judge', correct: true }).status, 'refused')
  act(w, 'sw', { kind: 'judge', correct: true })
  assert.deepEqual(w.step, { at: 'guess', holder: null })
  act(w, 's2', { kind: 'stroke', points: line })
  act(w, 's2', { kind: 'stroke', points: line })
  assert.equal(act(w, 's2', { kind: 'finishGuess' }).status, 'refused')
  act(w, 's2', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: false })
  assert.deepEqual(w.pad.sun[0].strikes, [[1, 2]])
  assert.equal(w.turn, 'moon')
})

test('finishing a guess asks the writer for a verdict; win ends the game', () => {
  const w = started()
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: true })
  act(w, 's1', { kind: 'finishGuess' })
  assert.equal(w.pad.sun[0].ended, true)
  assert.deepEqual(w.step, { at: 'judgeWord' })
  act(w, 'sw', { kind: 'verdict', win: true })
  assert.equal(inkFinished(w), true)
  assert.deepEqual(inkResults(w).map((r) => r.playerId).sort(), ['s1', 's2', 'sw'])
})

test('not it ends the turn without ending the game', () => {
  const w = started()
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: true })
  act(w, 's1', { kind: 'finishGuess' })
  act(w, 'sw', { kind: 'verdict', win: false })
  assert.equal(inkFinished(w), false)
  assert.equal(w.turn, 'moon')
})

test('redraw replaces the hand once per team and keeps the turn', () => {
  const w = started()
  const before = [...w.hands.sun]
  voteAll(w, 'redraw')
  assert.deepEqual(w.step, { at: 'choose' })
  assert.equal(w.hands.sun.length, 7)
  assert.notDeepEqual(w.hands.sun, before)
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'redraw' }).status, 'refused')
})

/** Plays a sun clue with one stroke and no period, then passes moon's turn with a wrong guess letter. */
function sunClueMoonMiss(w: InkWorld) {
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'stop' })
  act(w, 'sw', { kind: 'done' })
  voteAll(w, 'guess')
  act(w, 'm1', { kind: 'stroke', points: line })
  act(w, 'm1', { kind: 'check' })
  act(w, 'mw', { kind: 'judge', correct: false })
}

test('a turn starting on a peek row picks an unfinished clue and its writer adds one letter', () => {
  const w = started()
  sunClueMoonMiss(w) // sun row 1, moon row 1
  sunClueMoonMiss(w) // sun row 2, moon row 2
  assert.equal(w.turn, 'sun')
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'stop' })
  act(w, 'sw', { kind: 'done' }) // sun row 3; moon now starts on row 3, a peek row
  assert.equal(w.turn, 'moon')
  assert.equal(w.row, 2)
  assert.deepEqual(w.step, { at: 'peekPick' })
  assert.deepEqual(peekTargets(w), ['sun:0', 'sun:1', 'sun:2'])
  assert.equal(act(w, 'm1', { kind: 'vote', choice: 'moon:0' }).status, 'refused')
  act(w, 'm1', { kind: 'vote', choice: 'sun:1' })
  assert.equal(w.step.at, 'peekWrite')
  assert.equal(act(w, 'sw', { kind: 'done' }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(w.pad.sun[1].strokes.at(-1)?.peek, true)
  act(w, 'sw', { kind: 'done' })
  assert.deepEqual(w.step, { at: 'choose' })
  assert.equal(w.turn, 'moon')
})

test('a peek row with nothing to peek goes straight to choosing', () => {
  const w = started()
  for (let i = 0; i < 2; i++) {
    voteAll(w, 'guess')
    act(w, 's1', { kind: 'stroke', points: line })
    act(w, 's1', { kind: 'check' })
    act(w, 'sw', { kind: 'judge', correct: false })
    voteAll(w, 'guess')
    act(w, 'm1', { kind: 'stroke', points: line })
    act(w, 'm1', { kind: 'check' })
    act(w, 'mw', { kind: 'judge', correct: false })
  }
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: false })
  assert.equal(w.row, 2)
  assert.deepEqual(w.step, { at: 'choose' })
})

test('both teams lose when all sixteen rows fill', () => {
  const w = started()
  for (let i = 0; i < 16; i++) {
    const team = w.turn
    const g = w.roster[team].guessers[0]
    voteAll(w, 'guess')
    act(w, g, { kind: 'stroke', points: line })
    act(w, g, { kind: 'check' })
    act(w, w.roster[team].writer, { kind: 'judge', correct: false })
  }
  assert.deepEqual(w.step, { at: 'over', winner: null })
  assert.deepEqual(inkResults(w), [])
})
```

- [ ] **Step 2: Run tests**

Run: `node --test server/minigames/ink/world.test.ts`
Expected: PASS. Fix `world.ts` for any failure that the spec supports.

- [ ] **Step 3: Commit**

```bash
git add server/minigames/ink
git commit -m "test: ink guessing, peek rows, redraw and game end"
```

---

### Task 6: Ink definition, frames and visibility

**Files:**
- Create: `server/minigames/ink/definition.ts`, `server/minigames/ink/definition.test.ts`
- Modify: `server/minigames/registry.ts`, `shared/protocol.ts`, `client/minigames.tsx` (temporary `null` entries so typecheck passes are added in Task 8; here add the id and names only)

**Interfaces:**
- Consumes: world functions from Task 3; `lobbyStartable` from Task 1; `loadInkCards`, `INK_CARDS_PATH` from Task 2.
- Produces:
  - `makeInk(load: () => InkCards | string, rand?: () => number): MinigameDefinition<InkWorld>`
  - `ink` (registry entry)
  - Frame types below, used by Task 8.

- [ ] **Step 1: Protocol frame types**

Change `MinigameId` to `'bow' | 'tank' | 'ink'`. Add:

```ts
export type InkStrokeView = { points: InkPoint[]; author: PlayerId; peek?: true }
export type InkRowView = { kind: 'clue' | 'guess' | null; strokes: InkStrokeView[]; strikes: [number, number][]; ended: boolean; won?: true }
export type InkRoster = Record<InkTeamName, { writer: PlayerId; guessers: PlayerId[] }>

export type InkStepView =
  | { at: 'choosing' }
  | { at: 'peekPick'; targets: string[] }
  | { at: 'peekWrite'; team: InkTeamName; row: number }
  | { at: 'choose'; canRedraw: boolean }
  | { at: 'offer' }
  | { at: 'keep' }
  | { at: 'clue'; stopped: boolean }
  | { at: 'guess'; holder: PlayerId | null }
  | { at: 'judgeLetter' }
  | { at: 'judgeWord' }
  | { at: 'over'; winner: InkTeamName | null }

export type InkShared = {
  roster: InkRoster
  turn: InkTeamName
  row: number
  step: InkStepView
  /** Present when the pad changed, and once a second. */
  pad?: Record<InkTeamName, InkRowView[]>
  live: { player: PlayerId; team: InkTeamName; row: number; points: InkPoint[] }[]
  discard: string[]
  deck: number
  /** Revealed to everyone once the game is over. */
  secret: string | null
}

export type InkCardView = { id: number; text: string }

export type InkPrivate = {
  me: { team: InkTeamName; role: 'writer' | 'guesser' }
  /** Guessers only. */
  hand: InkCardView[]
  /** The own team's votes. */
  votes: { player: PlayerId; choice: string }[]
  asked: string[]
  /** The two prompts in play: during keep for the team, then the kept one. */
  offered: InkCardView[]
  kept: string | null
  /** Writers see the secret word and, while choosing, the word card and picks. */
  wordCard: string[]
  picks: Partial<Record<InkTeamName, number>>
  canUndo: boolean
}
```

Add to the `MinigameFrame` union:

```ts
  | (FrameBase<'ink'> & { role: 'board' } & InkShared)
  | (FrameBase<'ink'> & { role: 'player' } & InkShared & InkPrivate)
```

In `client/minigames.tsx` add `ink: 'Phantom Ink'` to `MINIGAME_NAMES`. (Player and board entries arrive in Task 8; until then add `ink: BowPlayer` / `ink: BowBoard` placeholders so the records typecheck, and replace them in Task 8.)

- [ ] **Step 2: Write the failing definition tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { makeInk } from './definition.ts'
import { CARDS } from './fixtures.ts'
import type { InkWorld } from './types.ts'

const lobby = { teams: { sw: 'sun', s1: 'sun', mw: 'moon', m1: 'moon' } as const, volunteers: ['sw', 'mw'] }
const clock = (ms: number) => ms

function setup() {
  const ink = makeInk(() => CARDS, mulberry32(5))
  assert.equal(ink.prepare?.(), null)
  const { world } = ink.create(1, ['m1', 'mw', 's1', 'sw'], {}, { teams: { ...lobby.teams }, volunteers: [...lobby.volunteers] })
  return { ink, world }
}

test('prepare reports missing cards', () => {
  assert.equal(makeInk(() => 'missing').prepare?.(), 'ink-cards')
})

test('start uses the lobby rules', () => {
  const ink = makeInk(() => CARDS)
  assert.equal(ink.startable?.({ teams: { a: 'sun' }, volunteers: [] }, ['a', 'b']), 'unpicked')
})

test('classify accepts well-formed inputs only', () => {
  const { ink } = setup()
  assert.equal(ink.classify({ kind: 'ink', points: [[0, 0]] }), 'continuous')
  assert.equal(ink.classify({ kind: 'stroke', points: [[0, 0]], at: 1 }), 'discrete')
  assert.equal(ink.classify({ kind: 'judge', correct: true, at: 1 }), 'discrete')
  assert.equal(ink.classify({ kind: 'judge', correct: 'yes', at: 1 }), null)
  assert.equal(ink.classify({ kind: 'vote', choice: 3, at: 1 }), null)
  assert.equal(ink.classify({ kind: 'stop' }), null)
  assert.equal(ink.classify({ kind: 'nope', at: 1 }), null)
})

test('the board never sees the secret word, hands, votes or word card', () => {
  const { ink, world } = setup()
  ink.apply(world, 'sw', { kind: 'pickWord', index: 0, at: 1 })
  ink.apply(world, 'mw', { kind: 'pickWord', index: 0, at: 2 })
  ink.apply(world, 's1', { kind: 'vote', choice: 'ask', at: 3 })
  const board = JSON.stringify(ink.boardFrame(world, clock))
  assert.ok(!board.includes('Apple'))
  assert.ok(!board.includes('"hand"'))
  assert.ok(!board.includes('"votes"'))
  const shared = ink.boardFrame(world, clock) as { secret: string | null }
  assert.equal(shared.secret, null)
})

test('guessers see their hand and votes; the other team does not; writers see the secret word', () => {
  const { ink, world } = setup()
  ink.apply(world, 'sw', { kind: 'pickWord', index: 0, at: 1 })
  ink.apply(world, 'mw', { kind: 'pickWord', index: 0, at: 2 })
  const s1 = ink.playerFrame(world, 's1', clock) as { hand: unknown[]; secret: string | null; votes: unknown[] }
  const m1 = ink.playerFrame(world, 'm1', clock) as { hand: { id: number }[]; votes: unknown[] }
  const sw = ink.playerFrame(world, 'sw', clock) as { hand: unknown[]; secret: string | null }
  assert.equal(s1.hand.length, 7)
  assert.equal(s1.secret, null)
  assert.equal(sw.secret, 'Apple')
  assert.deepEqual(sw.hand, [])
  assert.ok(m1.hand.every((card) => world.hands.moon.includes(card.id)))
  assert.equal(ink.playerFrame(world, 'stranger', clock), null)
})

test('the full pad rides a frame only when it changed or once a second', () => {
  const { ink, world } = setup()
  const hasPad = () => 'pad' in (ink.boardFrame(world, clock) as object)
  assert.equal(hasPad(), true)
  ink.afterFrame!(world)
  assert.equal(hasPad(), false)
  world.padVersion++
  assert.equal(hasPad(), true)
  ink.afterFrame!(world)
  for (let i = 0; i < 20; i++) ink.step(world)
  assert.equal(hasPad(), true)
})

test('touches on cards reach teammates; touches on rows also reach the board', () => {
  const { ink, world } = setup()
  assert.deepEqual(ink.touchAudience!(world, 's1', 'card:3'), { players: ['sw', 's1'], board: false })
  assert.deepEqual(ink.touchAudience!(world, 'm1', 'row:sun:0'), { players: ['mw', 'm1'], board: true })
  assert.equal(ink.touchAudience!(world, 'stranger', 'card:3'), null)
})

test('the game is finished once over', () => {
  const { ink, world } = setup()
  assert.equal(ink.finished!(world), false)
  ;(world as InkWorld).step = { at: 'over', winner: null }
  assert.equal(ink.finished!(world), true)
})
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test server/minigames/ink/definition.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Implement `definition.ts`**

```ts
import type { InkPrivate, InkShared, InkStepView, PlayerId } from '../../../shared/protocol.ts'
import type { MinigameDefinition } from '../definition.ts'
import { lobbyStartable } from '../lobby.ts'
import { INK_CARDS_PATH, loadInkCards, type InkCards } from './cards.ts'
import { TEAMS, type InkWorld } from './types.ts'
import {
  applyInk, createInkWorld, inkFinished, inkResults, inkTarget, peekTargets, roleOf, validPoints,
} from './world.ts'

const STEP_MS = 50
const PAD_EVERY_TICKS = 20
const DISCRETE = new Set(['pickWord', 'vote', 'force', 'keep', 'stroke', 'undo', 'stop', 'done', 'endClue', 'check', 'judge', 'finishGuess', 'verdict'])

const sendsPad = (w: InkWorld) => w.padVersion !== w.sentVersion || w.tick >= w.nextPadTick

function stepView(w: InkWorld): InkStepView {
  const s = w.step
  switch (s.at) {
    case 'peekPick': return { at: 'peekPick', targets: peekTargets(w) }
    case 'peekWrite': return { at: 'peekWrite', team: s.team, row: s.row }
    case 'choose': return { at: 'choose', canRedraw: !w.redrawn[w.turn] }
    case 'keep': return { at: 'keep' }
    case 'clue': return { at: 'clue', stopped: s.stopped }
    case 'guess': return { at: 'guess', holder: s.holder }
    default: return s
  }
}

function shared(w: InkWorld): InkShared {
  const live: InkShared['live'] = []
  for (const [player, points] of Object.entries(w.live)) {
    const target = inkTarget(w, player)
    if (target) live.push({ player, team: target.team, row: target.row, points })
  }
  return {
    roster: w.roster,
    turn: w.turn,
    row: w.row,
    step: stepView(w),
    ...(sendsPad(w) ? { pad: w.pad } : {}),
    live,
    discard: w.discard.map((id) => w.cards.prompts[id]),
    deck: w.deck.length,
    secret: w.step.at === 'over' ? w.secret : null,
  }
}

function personal(w: InkWorld, playerId: PlayerId): InkPrivate | null {
  const me = roleOf(w, playerId)
  if (!me) return null
  const card = (id: number) => ({ id, text: w.cards.prompts[id] })
  const s = w.step
  const ours = me.team === w.turn
  const writer = me.role === 'writer'
  const undo = w.undoable
  const target = inkTarget(w, playerId)
  return {
    me,
    hand: writer ? [] : w.hands[me.team].map(card),
    votes: w.votes.filter(() => ours).map(({ player, choice }) => ({ player, choice })),
    asked: w.asked[me.team].map((id) => w.cards.prompts[id]),
    offered: ours && s.at === 'keep' ? s.offered.map(card) : [],
    kept: ours && s.at === 'clue' ? w.cards.prompts[s.prompt] : null,
    wordCard: writer && s.at === 'choosing' ? w.wordCard : [],
    picks: writer && s.at === 'choosing' ? w.picks : {},
    canUndo: !!undo && !!target && undo.player === playerId && undo.team === target.team && undo.row === target.row,
  }
}

export function makeInk(load: () => InkCards | string, rand: () => number = Math.random): MinigameDefinition<InkWorld> {
  let cards: InkCards | null = null
  return {
    stepMs: STEP_MS,
    untimed: true,
    options: () => ({}),
    prepare() {
      const loaded = load()
      if (typeof loaded === 'string') return 'ink-cards'
      cards = loaded
      return null
    },
    startable: lobbyStartable,
    create(_seed, participants, _options, lobby) {
      // prepare() runs on every start, so the cards are loaded here.
      return { world: createInkWorld({ rand, cards: cards!, lobby, participants }) }
    },
    finished: inkFinished,
    classify(input) {
      const i = input as { kind?: unknown; at?: unknown; points?: unknown; index?: unknown; choice?: unknown; prompt?: unknown; correct?: unknown; win?: unknown } | null
      if (i?.kind === 'ink') return validPoints(i.points) ? 'continuous' : null
      if (typeof i?.kind !== 'string' || !DISCRETE.has(i.kind) || typeof i.at !== 'number' || !Number.isFinite(i.at)) return null
      if (i.kind === 'stroke' && !validPoints(i.points)) return null
      if (i.kind === 'pickWord' && !Number.isInteger(i.index)) return null
      if (i.kind === 'vote' && typeof i.choice !== 'string') return null
      if (i.kind === 'keep' && !Number.isInteger(i.prompt)) return null
      if (i.kind === 'judge' && typeof i.correct !== 'boolean') return null
      if (i.kind === 'verdict' && typeof i.win !== 'boolean') return null
      return 'discrete'
    },
    apply: (world, playerId, input) => applyInk(world, playerId, input),
    step(world) { world.tick++ },
    afterFrame(world) {
      if (!sendsPad(world)) return
      world.sentVersion = world.padVersion
      world.nextPadTick = world.tick + PAD_EVERY_TICKS
    },
    tick: (world) => world.tick,
    boardFrame: (world) => shared(world),
    playerFrame(world, playerId) {
      const mine = personal(world, playerId)
      if (!mine) return null
      const view = shared(world)
      // Writers know the secret word from the start.
      return { ...view, ...mine, secret: mine.me.role === 'writer' ? world.secret : view.secret }
    },
    results: inkResults,
    touchAudience(world, playerId, target) {
      const me = roleOf(world, playerId)
      if (!me) return null
      const { writer, guessers } = world.roster[me.team]
      return { players: [writer, ...guessers], board: target.startsWith('row:') }
    },
  }
}

export const ink = makeInk(() => loadInkCards(INK_CARDS_PATH))
```

`TEAMS` is unused here; drop that import if typecheck flags it.

In `server/minigames/registry.ts`:

```ts
import { ink } from './ink/definition.ts'

export const MINIGAMES: Record<MinigameId, MinigameDefinition<any>> = { bow, tank, ink }
```

- [ ] **Step 5: Run tests and typecheck**

Run: `node --test server/minigames/ink/*.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol.ts server/minigames client/minigames.tsx
git commit -m "feat: ink definition, role frames and touch audience"
```

---

### Task 7: Client building blocks

**Files:**
- Create: `client/ink.ts`, `client/ink.test.ts`, `client/InkParts.tsx`
- Modify: `client/useSocket.ts`, `client/minigames.tsx` (add `touches` to props)

**Interfaces:**
- Consumes: protocol ink types (Task 6), `MinigameTouch` (Task 1).
- Produces:
  - `teamCap(connected: number): number`
  - `lobbyColumns(state: State): { team: InkTeamName; members: { id: string; name: string; volunteer: boolean }[]; count: number; cap: number; over: boolean }[]`
  - `strokePath(points: InkPoint[], width: number, height: number): string`
  - `quantizePoint(x: number, y: number): InkPoint`
  - `freshTouches(touches: TimedTouch[], now: number): TimedTouch[]` with `TimedTouch = MinigameTouch & { at: number }`
  - `useInkPad(frame): Record<InkTeamName, InkRowView[]> | null`
  - Components: `InkLobby`, `InkPad`, `InkCanvas`, `Touchable`, `VotePips`, `HoldButton`
  - `MinigamePlayerProps.touches` and `MinigameBoardProps.touches: TimedTouch[]`

- [ ] **Step 1: Write the failing helper tests**

`client/ink.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { freshTouches, lobbyColumns, quantizePoint, strokePath, teamCap, TOUCH_MS } from './ink.ts'
import { newState } from '../server/state.ts'

test('team capacity is half the room, rounded up', () => {
  assert.equal(teamCap(0), 0)
  assert.equal(teamCap(5), 3)
  assert.equal(teamCap(6), 3)
})

test('lobby columns count connected members and flag overfill', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
    { id: 'c', name: 'Cy', connected: true },
    { id: 'd', name: 'Dee', connected: false },
  ]
  state.minigame = {
    id: 'ink', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'sun', d: 'moon' }, volunteers: ['b'] },
  }
  const [sun, moon] = lobbyColumns(state)
  assert.equal(sun.count, 3)
  assert.equal(sun.cap, 2)
  assert.equal(sun.over, true)
  assert.deepEqual(sun.members.map((m) => [m.name, m.volunteer]), [['Ada', false], ['Bo', true], ['Cy', false]])
  assert.equal(moon.count, 0)
  assert.equal(moon.over, false)
})

test('stroke paths scale normalized points; a dot becomes a short segment', () => {
  assert.equal(strokePath([[0, 0], [0.5, 1]], 100, 20), 'M0 0L50 20')
  assert.equal(strokePath([[0.1, 0.5]], 100, 20), 'M10 10l0.01 0')
})

test('points clamp to the unit square and round to three decimals', () => {
  assert.deepEqual(quantizePoint(-0.2, 0.12345), [0, 0.123])
  assert.deepEqual(quantizePoint(1.5, 0.9996), [1, 1])
})

test('touches expire after the fade', () => {
  const touch = { playerId: 'a', name: 'Ada', target: 'card:1', x: 0, y: 0 }
  const kept = freshTouches([{ ...touch, at: 0 }, { ...touch, at: 500 }], TOUCH_MS + 1)
  assert.deepEqual(kept.map((t) => t.at), [500])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test client/ink.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `client/ink.ts`**

```ts
import type { InkPoint, InkTeamName, MinigameTouch, State } from '../shared/protocol.ts'

export const TOUCH_MS = 600
export const FORCE_MS = 2_000
/** Pad row width over height, on the board and in the writing canvas. */
export const ROW_ASPECT = 5
export const TEAM_LABEL: Record<InkTeamName, string> = { sun: 'Sun', moon: 'Moon' }

export type TimedTouch = MinigameTouch & { at: number }

export const teamCap = (connected: number) => Math.ceil(connected / 2)

export function lobbyColumns(state: State) {
  const lobby = state.minigame?.lobby ?? { teams: {}, volunteers: [] }
  const connected = state.players.filter((player) => player.connected)
  const cap = teamCap(connected.length)
  return (['sun', 'moon'] as const).map((team) => {
    const members = connected
      .filter((player) => lobby.teams[player.id] === team)
      .map((player) => ({ id: player.id, name: player.name, volunteer: lobby.volunteers.includes(player.id) }))
    return { team, members, count: members.length, cap, over: members.length > cap }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

export function strokePath(points: InkPoint[], width: number, height: number): string {
  const [first, ...rest] = points.map(([x, y]) => `${round(x * width)} ${round(y * height)}`)
  if (!first) return ''
  return rest.length ? `M${first}L${rest.join('L')}` : `M${first}l0.01 0`
}

export function quantizePoint(x: number, y: number): InkPoint {
  const q = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
  return [q(x), q(y)]
}

export const freshTouches = (touches: TimedTouch[], now: number) => touches.filter((touch) => now - touch.at <= TOUCH_MS)
```

- [ ] **Step 4: Run helper tests**

Run: `node --test client/ink.test.ts`
Expected: PASS.

- [ ] **Step 5: Touches in `useSocket` and the surface props**

In `client/useSocket.ts`:

```ts
  const [minigameTouches, setMinigameTouches] = useState<TimedTouch[]>([])
```

In `onmessage`:

```ts
        else if (msg.t === 'minigameTouch') {
          const at = performance.now()
          setMinigameTouches((list) => [...freshTouches(list, at), { ...msg.touch, at }])
        }
```

Return `minigameTouches` from the hook. Touch times use `performance.now()`; components compare against `performance.now()` too.

In `client/minigames.tsx` add `touches: TimedTouch[]` to both `MinigamePlayerProps` and `MinigameBoardProps` (import the type from `./ink.ts`). In `client/Player.tsx` and `client/Board.tsx` pass `touches={minigameTouches}` from `useSocket`.

- [ ] **Step 6: Implement `client/InkParts.tsx`**

```tsx
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ClientMsg, InkPoint, InkRowView, InkTeamName, MinigameFrame, State } from '../shared/protocol.ts'
import { FORCE_MS, ROW_ASPECT, TEAM_LABEL, TOUCH_MS, lobbyColumns, quantizePoint, strokePath, type TimedTouch } from './ink.ts'
import { colorForPlayer } from './ui.ts'

type InkFrame = Extract<MinigameFrame, { id: 'ink'; role: 'board' | 'player' }>
const W = 500
const H = W / ROW_ASPECT

/** Keeps the last full pad; frames only carry it when it changed. */
export function useInkPad(frame: InkFrame | null) {
  const pad = useRef<InkFrame['pad'] | null>(null)
  const match = useRef('')
  if (frame && match.current !== frame.matchId) {
    match.current = frame.matchId
    pad.current = null
  }
  if (frame?.pad) pad.current = frame.pad
  return pad.current ?? null
}

/** Re-renders while touch rings are fading. */
export function useTouchClock(touches: TimedTouch[]) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!touches.length) return
    const id = setInterval(() => setTick((n) => n + 1), 50)
    const stop = setTimeout(() => clearInterval(id), TOUCH_MS + 50)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [touches])
}

export function InkLobby({ state, playerId, send }: { state: State; playerId?: string | null; send?: (msg: ClientMsg) => void }) {
  const columns = lobbyColumns(state)
  const mine = playerId ? state.minigame?.lobby?.teams[playerId] : undefined
  const volunteering = !!playerId && !!state.minigame?.lobby?.volunteers.includes(playerId)
  return <section class="ink-lobby">
    {columns.map((column) => <div key={column.team} class={`ink-lobby__team ink-lobby__team--${column.team}`}>
      <header>
        <span class="eyebrow">{TEAM_LABEL[column.team]}</span>
        <span class={column.over ? 'readout ink-lobby__count is-over' : 'readout ink-lobby__count'}>{column.count}/{column.cap}</span>
      </header>
      <ul>
        {column.members.map((member) => <li key={member.id} style={{ color: colorForPlayer(state, member.id) }}>
          {member.name}{member.volunteer && <span class="ink-lobby__star" aria-label="volunteer to write"> ✎</span>}
        </li>)}
      </ul>
      {send && <button
        class={mine === column.team ? 'btn btn--primary' : 'btn'}
        onClick={() => send({ t: 'minigameLobby', change: mine === column.team ? { do: 'leave' } : { do: 'join', team: column.team } })}
      >{mine === column.team ? 'Leave' : `Join ${TEAM_LABEL[column.team]}`}</button>}
    </div>)}
    {send && mine && <button
      class={volunteering ? 'btn btn--primary ink-lobby__volunteer' : 'btn ink-lobby__volunteer'}
      onClick={() => send({ t: 'minigameLobby', change: { do: 'volunteer', on: !volunteering } })}
    >{volunteering ? 'Volunteering to write' : 'Volunteer to write'}</button>}
  </section>
}

/** Taps away from buttons become touches; recent touches on this target draw as fading rings. */
export function Touchable({ target, touches, onTouch, class: className, children }: {
  target: string
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  class?: string
  children: ComponentChildren
}) {
  const now = performance.now()
  return <div
    class={`ink-touchable ${className ?? ''}`}
    onPointerDown={(event) => {
      if (!onTouch || (event.target as Element).closest('button, .ink-canvas')) return
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      onTouch(target, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)
    }}
  >
    {children}
    {touches.filter((touch) => touch.target === target && now - touch.at <= TOUCH_MS).map((touch) => (
      <span
        key={`${touch.playerId}-${touch.at}`}
        class="ink-ring"
        style={{ left: `${touch.x * 100}%`, top: `${touch.y * 100}%`, '--ring': `${Math.max(0, 1 - (now - touch.at) / TOUCH_MS)}` }}
      ><span class="ink-ring__name">{touch.name}</span></span>
    ))}
  </div>
}

export function VotePips({ state, votes, choice }: { state: State; votes: { player: string; choice: string }[]; choice: (vote: string) => boolean }) {
  return <span class="ink-pips">
    {votes.filter((vote) => choice(vote.choice)).map((vote) => (
      <span key={vote.player} class="ink-pip" style={{ background: colorForPlayer(state, vote.player) }} />
    ))}
  </span>
}

export function HoldButton({ label, onHeld }: { label: string; onHeld: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const release = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  return <button
    class={holding ? 'btn ink-force is-holding' : 'btn ink-force'}
    style={{ '--force-ms': `${FORCE_MS}ms` }}
    onPointerDown={() => {
      setHolding(true)
      timer.current = setTimeout(() => { release(); onHeld() }, FORCE_MS)
    }}
    onPointerUp={release}
    onPointerLeave={release}
    onPointerCancel={release}
  >{label}</button>
}

function RowInk({ row, extra }: { row: InkRowView; extra?: InkPoint[][] }) {
  const struck = (i: number) => row.strikes.some(([from, to]) => i >= from && i <= to)
  return <>
    {row.strokes.map((stroke, i) => (
      <path key={i} d={strokePath(stroke.points, W, H)} class={`ink-stroke${stroke.peek ? ' is-peek' : ''}${struck(i) ? ' is-struck' : ''}`} />
    ))}
    {row.strikes.map(([from, to]) => {
      const points = row.strokes.slice(from, to + 1).flatMap((stroke) => stroke.points)
      const xs = points.map(([x]) => x * W)
      return <line key={from} x1={Math.min(...xs) - 4} x2={Math.max(...xs) + 4} y1={H / 2} y2={H / 2} class="ink-strike" />
    })}
    {row.ended && row.strokes.length > 0 && (() => {
      const last = Math.max(...row.strokes.flatMap((stroke) => stroke.points.map(([x]) => x)))
      return <circle cx={last * W + 10} cy={H * 0.85} r={3.5} class="ink-period" />
    })()}
    {extra?.map((points, i) => <path key={`live${i}`} d={strokePath(points, W, H)} class="ink-stroke is-live" />)}
  </>
}

export function InkRowSvg({ row, extra }: { row: InkRowView; extra?: InkPoint[][] }) {
  return <svg class="ink-row__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} class="ink-row__rule" />
    <RowInk row={row} extra={extra} />
  </svg>
}

/** Both pad pages. Peek rows carry an eye; the current row is lit. */
export function InkPad({ frame, pad, touches, onTouch, peekRows, pickable }: {
  frame: InkFrame
  pad: NonNullable<InkFrame['pad']>
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  peekRows: Record<InkTeamName, number[]>
  pickable?: (target: string) => ComponentChildren
}) {
  return <div class="ink-pad">
    {(['sun', 'moon'] as const).map((team) => <div key={team} class={`ink-pad__page ink-pad__page--${team}`}>
      <p class="eyebrow">{TEAM_LABEL[team]}</p>
      {pad[team].map((row, i) => {
        const target = `${team}:${i}`
        const live = frame.live.filter((entry) => entry.team === team && entry.row === i).map((entry) => entry.points)
        const current = frame.turn === team && frame.row === i && frame.step.at !== 'over'
        return <Touchable key={i} target={`row:${target}`} touches={touches} onTouch={onTouch}
          class={`ink-row${current ? ' is-current' : ''}${row.won ? ' is-won' : ''}`}>
          <span class="ink-row__num">{i + 1}{peekRows[team].includes(i + 1) && <span class="ink-row__eye" aria-label="peek row">◉</span>}</span>
          <InkRowSvg row={row} extra={live} />
          {pickable?.(target)}
        </Touchable>
      })}
    </div>)}
  </div>
}

/** Freehand capture over one row. Sends the live stroke every 50 ms and commits on lift. */
export function InkCanvas({ row, enabled, send }: {
  row: InkRowView
  enabled: boolean
  send: (input: { kind: 'ink'; points: InkPoint[] } | { kind: 'stroke'; points: InkPoint[] }) => void
}) {
  const points = useRef<InkPoint[] | null>(null)
  const lastSent = useRef(0)
  const [, redraw] = useState(0)
  const at = (event: PointerEvent): InkPoint => {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    return quantizePoint((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)
  }
  const finish = () => {
    const stroke = points.current
    points.current = null
    if (stroke?.length) send({ kind: 'stroke', points: stroke.slice(0, 500) })
    redraw((n) => n + 1)
  }
  return <svg
    class={enabled ? 'ink-canvas' : 'ink-canvas is-locked'}
    viewBox={`0 0 ${W} ${H}`}
    preserveAspectRatio="none"
    onPointerDown={(event) => {
      if (!enabled) return
      ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
      points.current = [at(event)]
      redraw((n) => n + 1)
    }}
    onPointerMove={(event) => {
      if (!points.current) return
      points.current.push(at(event))
      const now = performance.now()
      if (now - lastSent.current >= 50) {
        lastSent.current = now
        send({ kind: 'ink', points: points.current.slice(0, 500) })
      }
      redraw((n) => n + 1)
    }}
    onPointerUp={finish}
    onPointerCancel={finish}
  >
    <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} class="ink-row__rule" />
    <RowInk row={row} extra={points.current ? [points.current] : []} />
  </svg>
}
```

`FORCE_MS` comes from `client/ink.ts`; a CSS custom property typed through Preact's `style` object may need `as Record<string, string>` if typecheck complains.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client
git commit -m "feat: ink client helpers, pad, canvas and touch rings"
```

---

### Task 8: Ink surfaces, host panel and styles

**Files:**
- Create: `client/InkPlayer.tsx`, `client/InkBoard.tsx`, `client/minigame-info.ts`, `client/minigames.test.ts`
- Modify: `client/minigames.tsx`, `client/Host.tsx`, `client/style.css`

**Interfaces:**
- Consumes: everything from Task 7; frame types from Task 6.
- Produces: `MINIGAME_TIMED: Record<MinigameId, boolean>`; `PEEK_ROWS` mirrored on the client as `INK_PEEK_ROWS` in `client/ink.ts`.

- [ ] **Step 1: Share peek rows**

Move `PEEK_ROWS` into `shared/protocol.ts` as `export const INK_PEEK_ROWS: Record<InkTeamName, number[]> = { sun: [4, 6, 7], moon: [3, 5, 6] }` and have `server/minigames/ink/types.ts` re-export it as `PEEK_ROWS`. The client imports `INK_PEEK_ROWS` from protocol.

- [ ] **Step 2: Failing test for the untimed host readout**

`client/minigames.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { MINIGAME_TIMED } from './minigame-info.ts'

test('only ink runs without a clock', () => {
  assert.deepEqual(MINIGAME_TIMED, { bow: true, tank: true, ink: false })
})
```

Node's type stripping cannot load `.tsx`, so `MINIGAME_TIMED` lives in `client/minigame-info.ts`; `Host.tsx` imports it from there.

Run: `node --test client/minigames.test.ts`
Expected: FAIL.

- [ ] **Step 3: Registry and host panel**

Create `client/minigame-info.ts`:

```ts
import type { MinigameId } from '../shared/protocol.ts'

export const MINIGAME_TIMED: Record<MinigameId, boolean> = { bow: true, tank: true, ink: false }
```

In `client/minigames.tsx`, replace the Task 6 placeholders with `ink: InkPlayer` and `ink: InkBoard`.

In `client/Host.tsx` `BowHost`, replace the duration paragraph with:

```tsx
      <p>{!MINIGAME_TIMED[session.id]
        ? 'No time limit'
        : session.phase === 'playing' ? `${remaining} seconds left` : `${session.options.durationSec} second match`}</p>
      {session.phase === 'ready' && !MINIGAME_TIMED[session.id] && <p class="muted">Players pick teams on their phones.</p>}
```

Run: `node --test client/minigames.test.ts`
Expected: PASS.

- [ ] **Step 4: `client/InkBoard.tsx`**

```tsx
import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { MinigameFrame } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { TEAM_LABEL } from './ink.ts'
import { InkLobby, InkPad, useInkPad, useTouchClock } from './InkParts.tsx'

type Frame = Extract<MinigameFrame, { id: 'ink'; role: 'board' }>

export function stepLine(frame: Pick<Frame, 'step' | 'turn'>, nameOf: (id: string) => string): string {
  const team = TEAM_LABEL[frame.turn]
  const s = frame.step
  switch (s.at) {
    case 'choosing': return 'Writers are choosing the secret word'
    case 'peekPick': return `${team} is picking a clue to peek`
    case 'peekWrite': return `${TEAM_LABEL[s.team]} writer adds one letter`
    case 'choose': return `${team}: Ask or Guess?`
    case 'offer': return `${team} is choosing prompts`
    case 'keep': return `${team} writer is picking a prompt`
    case 'clue': return s.stopped ? `${team} called Stop` : `${team} writer is writing`
    case 'guess': return s.holder ? `${nameOf(s.holder)} is guessing` : `${team} is guessing`
    case 'judgeLetter': return `${team} writer is checking the letter`
    case 'judgeWord': return `${team} writer is checking the guess`
    case 'over': return s.winner ? `${TEAM_LABEL[s.winner]} wins` : 'Both teams lose'
  }
}

export function InkBoard({ state, frame, touches }: MinigameBoardProps) {
  const session = state.minigame!
  const ink = frame?.role === 'board' && frame.id === 'ink' && frame.matchId === session.matchId ? frame : null
  const pad = useInkPad(ink)
  useTouchClock(touches)
  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'

  if (session.phase === 'ready' || !ink || !pad) {
    return <main class="ink-board">
      <h1 class="ink-board__title">Phantom Ink</h1>
      <InkLobby state={state} />
    </main>
  }
  return <main class="ink-board">
    <header class="ink-board__bar">
      <span class={`chip ink-turn ink-turn--${ink.turn}`}>{TEAM_LABEL[ink.turn]}</span>
      <span class="ink-board__step">{stepLine(ink, nameOf)}</span>
      {ink.secret && <span class="ink-board__secret">{ink.secret}</span>}
    </header>
    <InkPad frame={ink} pad={pad} touches={touches} peekRows={INK_PEEK_ROWS} />
    <footer class="ink-board__foot">
      {(['sun', 'moon'] as const).map((team) => <p key={team} class="muted">
        {TEAM_LABEL[team]}: {nameOf(ink.roster[team].writer)} writes · {ink.roster[team].guessers.map(nameOf).join(', ')}
      </p>)}
      <p class="eyebrow">Discarded</p>
      <ul class="ink-discard">{ink.discard.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </footer>
  </main>
}
```

- [ ] **Step 5: `client/InkPlayer.tsx`**

```tsx
import { useRef } from 'preact/hooks'
import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { InkInput, MinigameFrame } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { TEAM_LABEL } from './ink.ts'
import { stepLine } from './InkBoard.tsx'
import { HoldButton, InkCanvas, InkLobby, InkPad, Touchable, VotePips, useInkPad, useTouchClock } from './InkParts.tsx'

type Frame = Extract<MinigameFrame, { id: 'ink'; role: 'player' }>

export function InkPlayer({ state, playerId, frame, now, send, touches }: MinigamePlayerProps) {
  const session = state.minigame!
  const ink = frame?.role === 'player' && frame.id === 'ink' && frame.matchId === session.matchId ? frame as Frame : null
  const pad = useInkPad(ink)
  const seq = useRef(1)
  const picked = useRef<number[]>([])
  useTouchClock(touches)

  if (session.phase === 'ready') return <main class="ink-phone"><InkLobby state={state} playerId={playerId} send={send} /></main>
  if (!ink || !pad) return <main class="ink-phone"><p class="muted">{frame?.role === 'spectator' ? 'Watching this game' : 'Starting…'}</p></main>

  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'
  const input = (value: { kind: string } & Record<string, unknown>) => send({
    t: 'minigameInput', matchId: session.matchId, seq: seq.current++,
    input: (value.kind === 'ink' ? value : { ...value, at: now() }) as InkInput,
  })
  const touch = (target: string, x: number, y: number) => send({ t: 'minigameTouch', matchId: session.matchId, target, x, y })
  const s = ink.step
  const ours = ink.me.team === ink.turn
  const writer = ink.me.role === 'writer'
  const myVote = ink.votes.find((vote) => vote.player === playerId)?.choice ?? ''
  const vote = (choice: string) => input({ kind: 'vote', choice: myVote === choice ? '' : choice })
  const voting = ours && !writer && (s.at === 'choose' || s.at === 'offer' || s.at === 'peekPick')
  const writingRow = s.at === 'peekWrite' ? pad[s.team][s.row] : pad[ink.turn][ink.row]
  const canWrite =
    (s.at === 'clue' && ours && writer) ||
    (s.at === 'peekWrite' && ink.roster[s.team].writer === playerId) ||
    (s.at === 'guess' && ours && !writer && (s.holder === null || s.holder === playerId))

  return <main class={`ink-phone ink-phone--${ink.me.team}`}>
    <header class="ink-phone__bar">
      <span class={`chip ink-turn ink-turn--${ink.me.team}`}>{TEAM_LABEL[ink.me.team]} · {writer ? 'Writer' : 'Guesser'}</span>
      <span>{stepLine(ink, nameOf)}</span>
    </header>

    {writer && ink.secret && <p class="ink-phone__secret">Secret word: <strong>{ink.secret}</strong></p>}
    {!writer && s.at === 'over' && ink.secret && <p class="ink-phone__secret">It was <strong>{ink.secret}</strong></p>}
    {ink.kept && <p class="ink-phone__kept">Prompt: {ink.kept}</p>}

    {s.at === 'choosing' && writer && <ol class="ink-words">
      {ink.wordCard.map((word, i) => {
        const theirs = ink.picks[ink.me.team === 'sun' ? 'moon' : 'sun'] === i
        const mine = ink.picks[ink.me.team] === i
        return <li key={i}><button class={mine ? 'btn btn--primary' : 'btn'} onClick={() => input({ kind: 'pickWord', index: i })}>
          {i + 1}. {word}{theirs && !mine && ' — Confirm'}
        </button></li>
      })}
    </ol>}

    {s.at === 'keep' && ours && writer && <div class="ink-offer">
      {ink.offered.map((card) => <button key={card.id} class="btn ink-card" onClick={() => input({ kind: 'keep', prompt: card.id })}>{card.text}</button>)}
    </div>}

    {canWrite && <section class="ink-write">
      <InkCanvas row={writingRow} enabled send={(value) => input(value)} />
      <div class="ink-write__buttons">
        <button class="btn" disabled={!ink.canUndo} onClick={() => input({ kind: 'undo' })}>Undo last stroke</button>
        {s.at === 'clue' && <>
          <button class="btn btn--primary" disabled={!s.stopped} onClick={() => input({ kind: 'done' })}>{s.stopped ? 'Finish your letter, then Done' : 'Done'}</button>
          <button class="btn" onClick={() => input({ kind: 'endClue' })}>End clue</button>
        </>}
        {s.at === 'peekWrite' && <button class="btn btn--primary" onClick={() => input({ kind: 'done' })}>Done</button>}
        {s.at === 'guess' && <>
          <button class="btn btn--primary" onClick={() => input({ kind: 'check' })}>Check</button>
          <button class="btn" onClick={() => input({ kind: 'finishGuess' })}>Finish guess</button>
        </>}
      </div>
    </section>}

    {s.at === 'clue' && ours && !writer && <button class="btn btn--major btn--no ink-stop" disabled={s.stopped} onClick={() => input({ kind: 'stop' })}>Stop</button>}
    {s.at === 'judgeLetter' && ours && writer && <div class="ink-judge">
      <button class="btn btn--major btn--yes" onClick={() => input({ kind: 'judge', correct: true })}>Correct letter</button>
      <button class="btn btn--major btn--no" onClick={() => input({ kind: 'judge', correct: false })}>Wrong letter</button>
    </div>}
    {s.at === 'judgeWord' && ours && writer && <div class="ink-judge">
      <button class="btn btn--major btn--yes" onClick={() => input({ kind: 'verdict', win: true })}>Win</button>
      <button class="btn btn--major btn--no" onClick={() => input({ kind: 'verdict', win: false })}>Not it</button>
    </div>}

    {voting && s.at === 'choose' && <div class="ink-vote">
      {(['ask', 'guess', ...(s.canRedraw ? ['redraw'] : [])] as string[]).map((choice) => (
        <Touchable key={choice} target={`vote:${choice}`} touches={touches} onTouch={touch} class="ink-vote__option">
          <span>{choice === 'ask' ? 'Ask' : choice === 'guess' ? 'Guess' : 'Redraw hand'}</span>
          <VotePips state={state} votes={ink.votes} choice={(c) => c === choice} />
          <button class={myVote === choice ? 'btn btn--primary' : 'btn'} onClick={() => vote(choice)}>Vote</button>
        </Touchable>
      ))}
    </div>}

    {!writer && <section class="ink-hand">
      {s.at === 'offer' && ours && <p class="eyebrow">Pick two prompts</p>}
      {ink.hand.map((card) => {
        const inVote = (c: string) => c.split(',').includes(String(card.id))
        const selected = picked.current.includes(card.id)
        return <Touchable key={card.id} target={`card:${card.id}`} touches={touches} onTouch={touch} class={selected ? 'ink-card is-selected' : 'ink-card'}>
          <span>{card.text}</span>
          {voting && s.at === 'offer' && <>
            <VotePips state={state} votes={ink.votes} choice={inVote} />
            <button class={selected ? 'btn btn--primary' : 'btn'} onClick={() => {
              picked.current = selected ? picked.current.filter((id) => id !== card.id) : [...picked.current, card.id].slice(-2)
              if (picked.current.length === 2) vote([...picked.current].sort((a, b) => a - b).join(','))
              else if (myVote) input({ kind: 'vote', choice: '' })
            }}>Vote</button>
          </>}
        </Touchable>
      })}
    </section>}

    {voting && <HoldButton label="Force (hold 2 s)" onHeld={() => input({ kind: 'force' })} />}

    <InkPad
      frame={ink}
      pad={pad}
      touches={touches}
      onTouch={touch}
      peekRows={INK_PEEK_ROWS}
      pickable={voting && s.at === 'peekPick' ? (target) => s.targets.includes(target) && <>
        <VotePips state={state} votes={ink.votes} choice={(c) => c === target} />
        <button class={myVote === target ? 'btn btn--primary' : 'btn'} onClick={() => vote(target)}>Vote</button>
      </> : undefined}
    />

    {ink.asked.length > 0 && <details class="ink-asked"><summary>Asked prompts</summary>
      <ul>{ink.asked.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </details>}
  </main>
}
```

Clearing `picked` between turns: reset `picked.current = []` whenever `s.at !== 'offer'`, by adding `if (s.at !== 'offer') picked.current = []` before the return.

- [ ] **Step 6: Styles**

Append to `client/style.css`:

```css
/* Phantom Ink */
.ink-board, .ink-phone { min-height: 100dvh; background: var(--stage); color: var(--chalk); padding: var(--s4); display: grid; gap: var(--s4); align-content: start; }
.ink-board__title { font: 700 var(--t-mega)/1 var(--display); margin: 0; }
.ink-board__bar, .ink-phone__bar { display: flex; gap: var(--s3); align-items: center; font: 600 var(--t-lg)/1.2 var(--mono); }
.ink-phone__bar { font-size: var(--t-md); flex-wrap: wrap; }
.ink-board__secret { margin-left: auto; font: 700 var(--t-xl)/1 var(--display); color: var(--brass); }
.ink-turn--sun { color: var(--tungsten); }
.ink-turn--moon { color: var(--id-3); }

.ink-lobby { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); }
.ink-lobby__team { background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r-lg); padding: var(--s4); display: grid; gap: var(--s3); align-content: start; }
.ink-lobby__team header { display: flex; justify-content: space-between; align-items: baseline; }
.ink-lobby__team ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s1); font-size: var(--t-lg); }
.ink-lobby__count.is-over { color: var(--tally); }
.ink-lobby__team:has(.is-over) { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--tally) 12%, transparent); border-color: var(--tally); }
.ink-lobby__volunteer { grid-column: 1 / -1; }

.ink-pad { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); }
.ink-pad__page { display: grid; gap: var(--s2); align-content: start; }
.ink-row { display: grid; grid-template-columns: 2.5rem 1fr auto; align-items: center; gap: var(--s2); background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r-md); padding: var(--s1) var(--s2); }
.ink-row.is-current { border-color: var(--tungsten); }
.ink-row.is-won { border-color: var(--brass); }
.ink-row__num { font: 600 var(--t-sm)/1 var(--mono); color: var(--dim); }
.ink-row__eye { color: var(--cyan); margin-left: var(--s1); }
.ink-row__svg { width: 100%; aspect-ratio: 5; display: block; }
.ink-row__rule { stroke: var(--rule); stroke-width: 1; }
.ink-stroke { fill: none; stroke: var(--chalk); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.ink-stroke.is-peek { stroke: var(--cyan); }
.ink-stroke.is-live { stroke: var(--tungsten); }
.ink-stroke.is-struck { opacity: 0.45; }
.ink-strike { stroke: var(--tally); stroke-width: 4; }
.ink-period { fill: var(--chalk); }

.ink-canvas { width: 100%; aspect-ratio: 5; background: var(--raise); border: 1px solid var(--tungsten); border-radius: var(--r-md); touch-action: none; display: block; }
.ink-canvas.is-locked { border-color: var(--rule); }
.ink-write__buttons, .ink-judge, .ink-offer { display: flex; flex-wrap: wrap; gap: var(--s2); }
.ink-phone__secret { font-size: var(--t-lg); margin: 0; }
.ink-phone__kept { margin: 0; color: var(--dim); }
.ink-stop { width: 100%; }

.ink-touchable { position: relative; }
.ink-ring { position: absolute; width: 2.5rem; height: 2.5rem; margin: -1.25rem 0 0 -1.25rem; border-radius: 50%; border: 3px solid var(--chalk); opacity: var(--ring); transform: scale(calc(1.4 - var(--ring) * 0.4)); pointer-events: none; }
.ink-ring__name { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); font: 600 var(--t-xs)/1 var(--mono); white-space: nowrap; }

.ink-hand { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: var(--s2); }
.ink-card { background: var(--panel); border: 1px solid var(--rule); border-radius: var(--r-md); padding: var(--s3); display: grid; gap: var(--s2); }
.ink-card.is-selected { border-color: var(--tungsten); }
.ink-vote { display: grid; gap: var(--s2); }
.ink-vote__option { display: flex; align-items: center; gap: var(--s2); background: var(--panel); border-radius: var(--r-md); padding: var(--s2) var(--s3); }
.ink-vote__option > span:first-child { flex: 1; }
.ink-pips { display: inline-flex; gap: 3px; }
.ink-pip { width: 0.6rem; height: 0.6rem; border-radius: 50%; }
.ink-force { background-image: linear-gradient(var(--tungsten), var(--tungsten)); background-repeat: no-repeat; background-size: 0 100%; }
.ink-force.is-holding { background-size: 100% 100%; transition: background-size var(--force-ms) linear; color: var(--stage); }
.ink-words { list-style: none; padding: 0; display: grid; gap: var(--s2); }
.ink-discard { margin: 0; padding-left: var(--s4); color: var(--dim); }

@media (max-width: 700px) {
  .ink-pad { grid-template-columns: 1fr; }
}
```

Check existing `btn--yes`/`btn--no` class names in `style.css`; use the existing correct/wrong button classes if they differ.

- [ ] **Step 7: Validate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add shared client server/minigames/ink/types.ts
git commit -m "feat: ink phone and board surfaces"
```

---

### Task 9: Self-play walkthrough and docs

**Files:**
- Create: `tools/sim-ink.ts`
- Modify: `package.json`, `README.md`, `ARCHTECTURE.md`

- [ ] **Step 1: `tools/sim-ink.ts`**

```ts
/**
 * Synthetic self-play for Phantom Ink. Five bots join, pick teams, volunteer
 * and play until a team wins or the pad fills. Writers scribble random letters,
 * guessers stop after two letters and guess once a clue has four strokes.
 * Needs packs/phantom-ink.txt on the server.
 *
 *   npm run sim-ink
 *   npm run sim-ink -- http://box:8080
 *
 * Ctrl-C closes the minigame and removes the bots.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import type { InkInput, MinigameFrame } from '../shared/protocol.ts'

const URL = process.argv[2] ?? (await reachable())
const TEAMS = { Ivy: 'sun', Jax: 'sun', Kai: 'sun', Lux: 'moon', Mo: 'moon' } as const
const VOLUNTEERS = new Set(['Ivy', 'Lux'])

const host = await connect(URL, 'host')
const bots = new Map<string, { conn: Conn; seq: number; frame: MinigameFrame | null }>()
for (const name of Object.keys(TEAMS)) {
  const conn = await connect(URL, 'player', name, `sim-ink-${name}`)
  bots.set(conn.playerId, { conn, seq: 1, frame: null })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  for (const bot of bots.values()) bot.conn.close()
  host.close()
}
process.on('SIGINT', () => { stop(); process.exit(0) })

host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'ink', options: {} } })
await host.waitFor((s) => s.minigame?.id === 'ink' && s.minigame.phase === 'ready')
for (const bot of bots.values()) {
  const name = bot.conn.state()?.players.find((p) => p.id === bot.conn.playerId)?.name as keyof typeof TEAMS
  bot.conn.send({ t: 'minigameLobby', change: { do: 'join', team: TEAMS[name] } })
  await sleep(300)
  if (VOLUNTEERS.has(name)) bot.conn.send({ t: 'minigameLobby', change: { do: 'volunteer', on: true } })
  await sleep(300)
}
host.send({ t: 'host', action: { a: 'startMinigame' } })
const state = await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = state.minigame!.matchId

const letter = (): [number, number][] => {
  const x = Math.random() * 0.8 + 0.1
  return Array.from({ length: 8 }, (_, i) => [Math.min(1, x + i * 0.005), 0.2 + i * 0.08])
}

while (host.state()?.minigame?.phase === 'playing') {
  await sleep(700)
  for (const [id, bot] of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'ink' || frame.matchId !== matchId) continue
    const send = (input: Omit<InkInput, 'at'> & { kind: string }) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as InkInput })
    const s = frame.step
    const ours = frame.me.team === frame.turn
    const writer = frame.me.role === 'writer'
    const pad = frame.pad
    if (s.at === 'choosing' && writer) send({ kind: 'pickWord', index: 0 })
    else if (s.at === 'peekPick' && ours && !writer) send({ kind: 'vote', choice: s.targets[0] })
    else if (s.at === 'peekWrite' && frame.roster[s.team].writer === id) {
      send({ kind: 'stroke', points: letter() })
      await sleep(200)
      send({ kind: 'done' })
    } else if (s.at === 'choose' && ours && !writer) {
      const clues = pad?.[frame.turn].filter((row) => row.kind === 'clue').length ?? 0
      send({ kind: 'vote', choice: clues >= 3 ? 'guess' : 'ask' })
    } else if (s.at === 'offer' && ours && !writer) send({ kind: 'vote', choice: `${frame.hand[0].id},${frame.hand[1].id}` })
    else if (s.at === 'keep' && ours && writer) send({ kind: 'keep', prompt: frame.offered[0].id })
    else if (s.at === 'clue' && ours && writer) send(s.stopped ? { kind: 'done' } : { kind: 'stroke', points: letter() })
    else if (s.at === 'clue' && ours && !writer && (pad?.[frame.turn][frame.row].strokes.length ?? 0) >= 2) send({ kind: 'stop' })
    else if (s.at === 'guess' && ours && !writer && (s.holder === null || s.holder === id)) {
      const row = pad?.[frame.turn][frame.row]
      if ((row?.strokes.length ?? 0) >= 3) send({ kind: 'finishGuess' })
      else {
        send({ kind: 'stroke', points: letter() })
        await sleep(200)
        send({ kind: 'check' })
      }
    } else if (s.at === 'judgeLetter' && ours && writer) send({ kind: 'judge', correct: Math.random() < 0.7 })
    else if (s.at === 'judgeWord' && ours && writer) send({ kind: 'verdict', win: Math.random() < 0.5 })
  }
}
console.log('Game over:', JSON.stringify(host.state()?.minigame?.results))
await sleep(3_000)
stop()
```

Check `tools/conn.ts`: `frame()` is documented for board connections. If it only records frames for boards, extend it to record the latest frame for any role (a one-line change in its message handler).

Add to `package.json` scripts: `"sim-ink": "node tools/sim-ink.ts"`.

- [ ] **Step 2: Docs**

`README.md`, after the Tank section:

```markdown
### Phantom Ink minigame

Transcribe your own Phantom Ink cards into `packs/phantom-ink.txt` (gitignored):

    P: What is it made of?
    W: Apple | Calendar | Snowman | Chili | Fox | Table

`P:` lines are prompts (at least 16); `W:` lines are word cards of six words.
Press **Prepare Phantom Ink** on `/host`. Every phone picks Sun or Moon, and
anyone on a team may volunteer to write; the board shows both teams and turns a
count red when a team is over half the room. **Start match** needs everyone
picked and two per team, then draws each team's Writer from its volunteers.

Writers agree on the secret word from a shared word card. Guessers vote on
every team choice (Ask or Guess, which two prompts, which clue to peek, Redraw
hand); a choice applies when all of a team's Guessers agree, or when one of
them holds Force for two seconds. Writers write freehand in the team's row and
can undo only their latest stroke. Guessers tap Stop; the Writer finishes the
letter and taps Done, or taps End clue to add the period. A guess is written
one letter at a time and the Writer marks each Correct letter or Wrong letter,
then Win or Not it. Tapping a card or pad row shows a named ring on teammates'
phones (and the board, for pad rows). The game has no clock. A server restart
or Undo during play returns it to ready and the game is lost.

`npm run sim-ink` plays a bot game against the running server.
```

`ARCHTECTURE.md` minigame row: change the owner cell to include `server/minigames/ink/` and the responsibility to "Match lifecycle, fixed-step simulation, queued inputs, role frames, ready lobby and touch relay; bow, tank and ink rules behind registry definitions". Add one sentence after the bow traffic paragraph: "A definition may be untimed: the runtime then ignores `durationSec` and completes when the definition's `finished` hook reports true. Touches are relayed to the audience the definition names and never stored."

- [ ] **Step 3: Validate**

Run: `npm test && npm run typecheck && npm run build && git diff --check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/sim-ink.ts tools/conn.ts package.json README.md ARCHTECTURE.md
git commit -m "feat: ink self-play and docs"
```
