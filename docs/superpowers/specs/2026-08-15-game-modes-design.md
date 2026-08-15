# Game modes, items, and quizbowl-lite — design

Date: 2026-08-15

A framework for pluggable game modes plus a framework-level item system
(boons/sabotage), with quizbowl-lite as the proving module. A cine2nerdle-style
showdown module is explicitly deferred; the framework must not preclude it.

## Decisions (from brainstorming)

- Full framework before any new game is playable.
- Mode options are declared as a schema per module; the Host screen renders a
  settings form from that schema. No per-mode settings UI code.
- A module may fully replace a surface (Player/Board/Host settings) via a
  client registry, with fallback to the current default surfaces.
- Boons/sabotage are player-triggered items, fired from the player's phone.
- Mode is fixed per session; switching modes resets the game (host confirms).
- Showdown is out of scope; it arrives later as a module with replacement
  surfaces and zero framework changes.

## Architecture

### State

`State.mode` is already taken (solo/teams scoring). The game mode gets its own
slot:

```ts
type GameState = {
  id: string                        // 'trivia' | 'quizbowl' | future modules
  options: Record<string, unknown>  // values for the module's declared schema
  moduleState: unknown              // opaque to the framework; the module owns it
}
// State gains:  game: GameState
// State gains:  items: Record<PlayerId, string[]>   (item ids, duplicates = count)
// State gains:  effects: ActiveEffect[]             // e.g. { kind: 'frozen'; playerId; roundId }
```

Because all of this lives inside `State`, undo (the hub's `structuredClone`
stack), the debounced snapshot, and whole-state broadcast keep working
untouched. That is the entire reason for putting it here.

Effects are stamped with the round they apply to and swept on `arm`, so nothing
leaks across questions.

### Module definition

New `shared/modes/types.ts`; registry in `server/modes/`.

```ts
type OptionSpec =
  | { kind: 'int'; key: string; label: string; default: number; min: number; max: number }
  | { kind: 'bool'; key: string; label: string; default: boolean }
  | { kind: 'choice'; key: string; label: string; default: string; choices: string[] }

type GameModule = {
  id: string
  name: string
  options: OptionSpec[]
  init(options: Record<string, unknown>): unknown           // fresh moduleState
  canBuzz?(state: State, playerId: PlayerId): string | null // null = allowed
  onCorrect?(state: State): void    // default: leader gets round.value
  onWrong?(state: State, neg: number): void
  viewModuleState?(state: State, viewer: PlayerId | 'host' | 'board'): unknown
  grants?(state: State): ItemGrant[] // item drops, declared as data
}
```

Hooks are optional; a module defining none behaves exactly like today's game.
That zero-case ships as the `trivia` module, so current behavior is the
default, not a special case.

There is deliberately no mid-session lifecycle (modes are fixed per session),
no event bus, and no per-module `HostAction` types — module-specific host ops
ride the same `act` channel with the role checked.

### Wire

Three additions; nothing existing is reshaped.

- `ClientMsg` gains `{ t: 'act'; act: string; data?: unknown }` — module and
  item actions. The hub dispatches to the item layer or the active module's
  handler; unknown acts are dropped and logged once.
- `HostAction` gains `{ a: 'setGame'; id: string; options: Record<string, unknown> }`.
  Refused unless the round is IDLE; switching modes resets scores and the host
  UI confirms before sending.
- `ServerMsg` is unchanged: `state` already carries everything. The module
  catalog (id, name, option specs) ships as a static list in the state payload
  so the host settings form needs no fetch of its own.

### Redaction

`Hub.viewFor` delegates `game.moduleState` to the module's `viewModuleState`;
a module without one exposes nothing to players. The standing rule holds:
anything a player must not see early lives behind that method.

## Items (boons/sabotage)

Items are framework-level so they compose with any mode:

```ts
type ItemDef = {
  id: string
  name: string
  target: 'self' | 'opponent'
  usableWhen(state: State, userId: PlayerId): boolean
  apply(state: State, userId: PlayerId, targetId?: PlayerId): void
}
```

- Firing rides the `act` channel: `{ t: 'act'; act: 'useItem'; data: { itemId, targetId? } }`.
  The hub validates inventory, `usableWhen`, and target before `apply` runs,
  then removes the item. Items never invent their own message type.
- Mode hooks see effects transparently: the framework `canBuzz` consults
  `effects` (a frozen player gets `"frozen"` as the reason), so quizbowl never
  knows freeze exists and freeze never knows quizbowl exists.
- Granting: a module's `grants()` hook declares drops as data (e.g. quizbowl:
  "correct answer grants one random item"); the framework item layer executes.
  Distribution stays out of modules.
- First three items, chosen because each exercises a different hook point:
  - **freeze** — target opponent cannot buzz next round (canBuzz + effects).
  - **shield** — passive; eats the next freeze aimed at the holder
    (item-on-item interaction in the freeze `apply`).
  - **steal** — fire on a rebound to jump the order ahead of everyone not
    already locked out (mutates `round.order` mid-window).

## Quizbowl-lite (the proving module)

Options: `powerAfterFragment` (int, 0 = powers off), `powerBonus` (int),
`neg` (int), `bouncebacks` (bool), `itemsEnabled` (bool).

- **Power is a signal, not a timer.** `moduleState` carries
  `powerEndsAt?: number` (server-domain ms). A buzz is powered when its clamped
  press time < `powerEndsAt`. Press times are already clamped to
  `[armedAt, arrivedAt]`, so a phone cannot backdate into the window. The
  signal arrives as a host-scoped act (`act: 'powerEnds'`); until any reader
  fires it, power stays open the whole question, which degrades gracefully to
  "everything is a power" and is host-visible.
- **Reader**: new `npm run read` tool, a sibling of probe/sim over
  `tools/conn.ts`. It splits the question into fragments, speaks each via
  macOS `say`, and fires `powerEnds` after the configured fragment. A later
  Host-screen `speechSynthesis` reader uses the identical wire contract; the
  module never learns which reader drove it. (Out of scope for this spec.)
- **Neg**: `wrong` applies the configured neg; lockout behaves as today.
- **Bouncebacks**: on `wrong` in teams mode, the rebound round is restricted
  to teams not locked out — one flag, one filter in `canBuzz`. (This is very
  close to current lockout behavior; the option exists to disable it for
  free-for-all rebounds.)
- `moduleState` holds almost nothing beyond `powerEndsAt` — power eligibility
  derives from `order[].at` vs `armedAt`/`powerEndsAt`. This is the proof the
  blob stays small.

## Client

- `client/modes/index.ts`: maps `game.id` → `{ Player?, Board?, Settings? }`.
  `main.tsx` looks up the active mode and falls back to the current surfaces
  when a module overrides nothing. Trivia and quizbowl ship with zero new
  screens.
- Items add the only new player UI: an inventory row on `Player.tsx`, buttons
  firing `useItem`, rendered from `state.items` whenever non-empty —
  mode-agnostic.
- Host settings: one schema-driven form component (one renderer per
  OptionSpec kind) above the existing host controls, fed by the catalog in the
  state payload.

## Error handling

- Unknown mode id or unknown `act`: drop, log once.
- `setGame` refused unless phase is IDLE.
- `useItem` validates inventory, `usableWhen`, and target before `apply`; a
  failed validation consumes nothing and is silent to the room.
- Snapshot load whose `game.id` is no longer registered: fall back to `trivia`
  with defaults, log loudly.
- A reader disconnecting mid-question harms nothing; power stays open.

## Testing

- `resolve.ts` stays pure and untouched.
- New `node:test` coverage: quizbowl-lite scoring (power/neg/bounceback
  matrix), item validation and effect sweep on `arm`, `viewModuleState`
  redaction, `setGame` gating.
- One integration test driving a full quizbowl round over real sockets via
  `tools/conn.ts`, mirroring `server/integration.test.ts`.
- Sim gains a `--game quizbowl` flag rather than a new tool; probe gains
  `act:` steps.

## Explicitly not here

- Showdown module (deferred; arrives as a module with replacement surfaces).
- Mid-session mode switching with score preservation.
- Host-screen speechSynthesis reader (same wire contract as `npm run read`;
  add when someone wants it).
- Event-bus or declarative-JSON-ruleset architectures (rejected: second state
  path, worse undo/redaction story, or insufficient expressiveness for items).
