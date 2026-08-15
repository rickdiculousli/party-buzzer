# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A LAN buzzer for quizbowl and trivia nights. Host runs one command, players scan
a QR code. See `README.md` for running it and `docs/design.md` for the design
system — that document is the source of truth for anything visual, and
`client/tokens.css` is what the components actually read.

## Commands

```bash
npm start          # serve dist/ on :8080, prints the QR and join URL
npm run dev        # Vite HMR; run `npm start` alongside it for the API
npm run build      # vite build -> dist/  (npm start serves this, not client/)
npm test           # node:test
npm run typecheck
npm run sim        # synthetic self-play against a running server
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct   # one scripted round
npm run motion     # the animation harness at /anim.html (dev only)
npm run fakes -- add [n] / remove   # fake players with fake scores (ids fake-01..fake-99)
```

Run a single test file or case:

```bash
node --test server/resolve.test.ts
node --test --test-name-pattern="slow packet" 'server/*.test.ts'
```

`node --test server/` (a bare directory) does not work on Node 26 — the npm
script globs `'server/*.test.ts'` for a reason.

**`npm start` serves `dist/`.** A client change is invisible until you
`npm run build`. Server changes need the process restarted; there is no watch.

## Constraints

- **Node 26.7.0, pinned via mise.** Server code is native TypeScript — Node
  strips the types, there is no server build step. Relative imports therefore
  carry `.ts` extensions, and `enum`, `namespace`, and constructor parameter
  properties are unavailable.
- **No CDN, no remote assets, anywhere.** Party WiFi has no route to the
  internet. Fonts are self-hosted in `client/public/fonts`; anything new must be
  vendored the same way.
- **Runtime dependencies are exactly `ws` and `qrcode`.** Client is `preact`.
  Everything else is dev-only. Adding a runtime dependency is a decision, not a
  detail.
- Tests use `node:test` and `node:assert/strict` only.
- Deliberate simplifications that cut a real corner carry a `ponytail:` comment
  naming the ceiling and the upgrade path.
- A number an anchor needs is either a CSS custom property in `anim:tunables`
  or a field in a recipe in `cue:recipes` — never inlined into either a
  keyframe or a scenario.

## Architecture

`shared/protocol.ts` is the contract — every message type, the `State` shape,
and the two timing constants (`ARM_LEAD_MS`, `COLLECT_MS`) that both sides count
against. Read it first; it explains more than any other single file.

State flows one way. Clients send `ClientMsg`, the server mutates, then
broadcasts a whole `State` to everyone. There is no client-side game logic and
no partial update.

- `server/hub.ts` — connections, buzz collection, broadcast, undo. Owns all
  round timing.
- `server/state.ts` — `applyHostAction` (the round state machine) and the
  debounced snapshot to `state.json`.
- `server/resolve.ts` — pure. Turns raw buzzes into a ranked order.
- `server/index.ts` — HTTP + WebSocket, serves `dist/`, routes `/`, `/host`,
  `/board` to the same SPA shell.
- `client/useSocket.ts` — the socket, the clock sync, and `useOpen`. Every
  surface goes through it.
- `client/{Player,Host,Board}.tsx` — the three surfaces, chosen by pathname in
  `main.tsx`.
- `tools/sim.ts` — bots that play real questions over real sockets.

### The parts that are load-bearing

**The clamp.** `resolve.ts` trusts a client's claimed press time only within
`[armedAt, arrivedAt]`. It cannot predate the question opening or postdate its
own packet. That one line neutralises both a badly synced clock and a
hand-edited timestamp, and it is why ordering is by press time rather than
arrival. Do not loosen it.

**Scheduled arming.** `arm` sets `armedAt = Date.now() + ARM_LEAD_MS`; every
surface counts down to that instant on its own synced clock, so all phones open
together however late their packet landed. Buzzes arriving before `armedAt` are
dropped outright — arrival time is server truth, so this needs no tolerance.

**One window, revealed early.** The first buzz opens a `COLLECT_MS` (1s)
collection window; every buzz inside it is a contender, ordered by clamped press
time alone. 150ms in, the hub publishes the provisional order — the phase stays
`COLLECTING` while the timeline keeps filling, and the lead can still change
hands when a slow packet carries an earlier stamp. At the end of the second the
round locks.

**Redaction.** `Hub.viewFor(conn)` gives players only their own entry in
`order`. Anything a player must not see early belongs behind that method.

**Undo is server-side**, a stack of `structuredClone(state)` in the hub, restored
with `Object.assign` so the `state` object identity survives for the persistence
layer holding the reference.

### Client gotchas

- `now()` is server-domain time. The offset is seeded from the device clock so
  it is usable before sync lands; a countdown computed from it is clamped to its
  constant, because an unclamped one silently became ~1.7 trillion ms and the
  buzzers never opened.
- Preact hooks must be called before any early return. All three surfaces derive
  round state above their `if (!state)` guard for this reason.
- `pointerdown`, never `click`. The AudioContext only unlocks inside a user
  gesture, which is why the join tap is mandatory even for a returning phone.

## Verifying

`npm run sim` is the fastest way to see a change in motion — it drives real
rounds with uneven bots, so timeline clustering, late arrivals, lockouts and
rebounds all show up without hand-driving a phone. `npm run sim -- 5 2` runs five
questions at half speed, Ctrl-C removes the bots. You can join from a phone
mid-run; the sim treats a human leader as always correct, so don't read the
standings as a fairness signal when one is playing.

`npm run probe` is the other half, for when you need one exact moment rather
than a believable game. You name the buzzes and their offsets and it happens on
the spot, the same way every time, so a photo finish or a four-mark staircase is
a command instead of a wait on dice. It is one-shot: the steps run, the process
exits, and the board stays on the frame the last step produced — the screen is
server state, so nothing has to stay running to hold it there. `clear` puts the
room back.

```bash
npm run probe -- value:400 join:Ada,Bo,Cy arm buzz:Ada@0,Bo@140,Cy@390
npm run probe -- clear
npm run anim     # every anchor animation, on a loop, until Ctrl-C
```

`join:Name` borrows a player of that name if one is already in the room (a
`fakes` entry, a real phone) rather than putting a second Ada on the board;
anyone it does mint gets a `probe-` id, which is the only thing `clear` kicks.
Probe and the sim share `tools/conn.ts` — real sockets, real clock sync, no
shortcut through the HTTP layer.

`npm run motion` opens the animation harness — the only one of the three that
needs no server at all, because it is tuning CSS rather than exercising the
game. Pick an anchor, retrigger it or loop it, and drop the speed to 0.1× to
actually see where the light sits relative to the movement; a 110ms stamp is
eleven frames at full speed and there is nothing to judge in that.

Its numbers are the `anim:tunables` block in `client/style.css`, and **Save**
rewrites that block in place through a dev-only Vite middleware, so a value you
dialled in cannot change on its way home. The scenarios live in
`client/anim/scenarios.tsx` and render each component inside a copy of its real
container — bloom against an empty void reads nothing like bloom beside a cyan
rail and three other names. The harness is dev-only by construction:
`anim.html` is left out of `build.rollupOptions.input`, so `npm run build`
never emits it.

Two rules for it. Never restate a value in a scenario — a scenario that carries
its own duration is tuning a copy of the CSS rather than the CSS. And never
inline a number into an anchor keyframe: one the harness cannot reach is one
nobody will tune.

The same page has a **Sound** panel. Cues named in `client/cues.ts` are
synthesized rather than found: a recipe is a list of layers, each one source
with an envelope, and its dials write back into the `cue:recipes` block through
the same Save that writes the CSS. Drag the envelope canvas rather than
inferring the shape from four sliders.

Sounds that must stay found live in `sounds/raw/`, which is gitignored — drop a
download in and it appears in the panel's Library, auditionable through the
current trim so you hear what you are about to bake in. **Adopt** runs one of
two `ffmpeg` presets, writes the result into `client/public/sounds/`, and
appends the row to `CREDITS.md` with the exact command. `ffmpeg` is a machine
binary invoked through `child_process`; it is not and must not become an npm
dependency.

Before a real game night, walk `docs/manual-checklist.md`.
