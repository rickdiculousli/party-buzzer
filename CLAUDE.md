# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A LAN buzzer for quizbowl and trivia nights. Host runs one command, players scan
a QR code. See `README.md` for running it and `docs/design.md` for the design
system — that document is the source of truth for anything visual, and
`client/tokens.css` is what the components actually read.

## Commands

```bash
npm start          # serve dist/ on :8080, print the QR, open /host and /board
                   # (NO_OPEN=1 to keep the tabs shut)
npm run dev        # Vite HMR; run `npm start` alongside it for the API
npm run build      # vite build -> dist/  (npm start serves this, not client/)
npm test           # node:test
npm run typecheck
npm run sim        # synthetic self-play against a running server
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct   # one scripted round
npm run walk-duel / walk-teams      # the two paced duel walkthroughs, ~1 min each
npm run walk-flow  # the paced setlist walkthrough, ~1 min
npm run motion     # the animation harness at /anim.html (dev only)
npm run fakes -- add [n] / remove   # fake players with fake scores (ids fake-01..fake-99)
npm run demo-sounds [clean]         # synthesized stand-ins so the sound library has entries
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
- **No CDN, no remote assets, anywhere.** Nothing a surface renders may be
  fetched at play time — party WiFi is somebody's guest network and a font that
  hangs is a black screen mid-question. Fonts are self-hosted in
  `client/public/fonts`; anything new must be vendored the same way.
  The one thing that does reach the internet is `server/cert.ts`, at boot, and
  it degrades to plain http when it cannot. See **The certificate** below.
- **Runtime dependencies are exactly `ws` and `qrcode`.** Client is `preact`.
  Everything else is dev-only. Adding a runtime dependency is a decision, not a
  detail.
- Tests use `node:test` and `node:assert/strict` only.
- Deliberate simplifications that cut a real corner carry a `ponytail:` comment
  naming the ceiling and the upgrade path.
- A number an anchor needs is either a CSS custom property in `anim:tunables`
  or a field in a recipe in `cue:recipes` — never inlined into either a
  keyframe or a scenario. The split is by kind, not by convenience: how a thing
  looks and moves is CSS, how it sounds is its recipe. No cue's gain, offset or
  envelope lives in a stylesheet; the one cue still on the sample path keeps its
  four numbers in `BED` in `client/sound.ts`.

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
- `server/modes/` — game modules. `GameModule` hooks (scoring, power, item
  grants) are all optional; `trivia` defines none and is today's game.
  Modes are fixed per session; `setGame` switches and resets.
- `server/items.ts` — framework-level boons/sabotage (freeze, shield, steal),
  fired by players over the `act` channel and validated before they apply.
- `server/duel.ts` — heads-up duels (two-player face-offs). Framework-level,
  composes with any mode: selection rules are data in a catalog, entry rides
  the `act` channel, and enforcement is one `round.candidates` check at the
  hub's buzz gate. A wrong answer narrows candidates to the other finalist,
  which is the whole rebound mechanic.
- `server/flow.ts` — the game flow: an ordered setlist of blocks. It advises
  and never arms — entering a block applies its setup and stops, so the host
  still arms, judges and moves on.
- `server/flows.ts` — saved flows on disk, filenames in `State` like `packs`.
- `server/index.ts` — HTTP + WebSocket, serves `dist/`, routes `/`, `/host`,
  `/board` to the same SPA shell.
- `client/useSocket.ts` — the socket, the clock sync, and `useOpen`. Every
  surface goes through it.
- `client/{Player,Host,Board}.tsx` — the three surfaces, chosen by pathname in
  `main.tsx`.
- `tools/sim.ts` — bots that play real questions over real sockets.
- `server/reader.ts` — the question loop. Drives the hub through a synthetic
  host connection, so it uses the same messages a socket client would and the
  hub grows no reader API. `state.autoplay` turns its two waits-on-the-host
  into dwells — the payoff's N and the beat before a rebound resumes — and
  passes a question nobody buzzed, which is the only way the loop can be left
  unattended. The judgment itself is never automated here; that is the judge's.
- `server/judge.ts` — spoken answers while the reader drives. Opens a window
  when a round locks with a leader, transcribes via `server/stt/stt.swift`
  (swiftc-built at boot, on-device), fuzzy-matches against the pack's answer
  variants (`server/match.ts`), and returns the verdict through a synthetic
  host connection — undo and rebound apply unchanged. Primed answers live in
  memory only, never in State.
- `server/speech.ts` — `say` pre-rendered to cached clips, played by `afplay`.
  Pause kills the clip and re-reads the fragment from its start, and so does a
  buzz — the reader must not talk over the room. The power boundary stays
  event-driven so neither can desynchronise it.
- `server/packs.ts` — pack files on disk. `State` carries filenames only.

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

**Modes and items live inside `State`.** `game.moduleState`, `items`, and
`effects` ride the same snapshot/undo/broadcast path as everything else —
that is why the framework adds no new persistence or timing code. Effects are
stamped with the arm they belong to and swept on the next, so nothing leaks
across questions.

**Undo is server-side**, a stack of `structuredClone(state)` in the hub, restored
with `Object.assign` so the `state` object identity survives for the persistence
layer holding the reference.

**The server reads, but never remembers.** Question content lives in server
memory while a pack is loaded and never enters `State` — only fragments the room
has already heard. That is what keeps a phone from seeing ahead, and it is why
the mirror is safe to offer at all.

**The certificate.** Push-to-talk needs `getUserMedia`, which browsers refuse
outside a secure context — and a plain-http LAN address is not one. They do not
merely refuse it: `navigator.mediaDevices` is left *undefined*, so the request
for mic permission never prompts and every failure downstream is silent. No CA
will issue a certificate to `192.168.x.x`, so `server/cert.ts` uses the public
workaround: `local-ip.sh` resolves `192-168-0-74.local-ip.sh` to that address
and publishes a real Let's Encrypt wildcard for `*.local-ip.sh` along with its
private key. Published key, so it is worthless against a man in the middle —
but it buys a secure context with no interstitial and nothing to install on a
guest's phone, and the threat model on a living-room LAN is nobody.

Consequences worth knowing before changing any of it:

- **The QR encodes the hostname, not the IP.** The certificate covers the name;
  the raw address would not match it. `npm start` prints the IP url too, because
  if local-ip.sh's DNS is down that url is the only way anyone joins at all.
- **It is cached in `.cert/` and refetched within 7 days of expiry.** A normal
  90-day certificate, so it turns over four times a year. No internet at boot
  and no cache means plain http, which means no microphone — the banner says so
  rather than leaving you to discover it mid-question.
- **Tests and `e2e.ts` pass `tls: false`.** Boot must never touch the network.
- **The tools find the server themselves** — `reachable()` in `tools/conn.ts`
  tries the https loopback name (`127-0-0-1.local-ip.sh`, covered by the same
  wildcard) and then plain http. `URL=` overrides.

### Client gotchas

- `now()` is server-domain time. The offset is seeded from the device clock so
  it is usable before sync lands; a countdown computed from it is clamped to its
  constant, because an unclamped one silently became ~1.7 trillion ms and the
  buzzers never opened.
- Preact hooks must be called before any early return. All three surfaces derive
  round state above their `if (!state)` guard for this reason.
- `pointerdown`, never `click`. The AudioContext only unlocks inside a user
  gesture, which is why the join tap is mandatory even for a returning phone.
- **One AudioContext per page, and the join tap is where it is unlocked.** The
  `Recorder` borrows it rather than building its own, because a context created
  in an effect has no gesture to unlock it with — it starts `suspended`, and a
  suspended context never runs its worklet, so `process()` is simply not called
  and the recording is an empty buffer that gets dropped without a word.

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

Probe also drives a whole duel — `duel:` opens one, `vote:Bo=Ada` and
`in:`/`out:` are sent from each player's own socket (a `duel*` act from the
host connection is dropped, which is the rule worth exercising rather than
routing around), `unvote:` takes a vote back so you can watch a tally count
down, and `seat`/`cancel` close the window. `teams:Red=Ada,Bo/Blue=Cy,Dee` sets
the mode, the teams and the assignments in one step, reusing a team of that name
if the room already has one and leaving the mode alone if it is already teams —
`setMode` drops an open duel, so re-sending it to add one late player would
cancel the window you were about to watch.
`speak:Name=transcript` POSTs the transcript as `text/plain` into the judge's
verdict path, so a whole spoken round is one command; real audio is the
checklist's.

In teams mode a vote may only name someone on the voter's own side: the seat
takes one player per team, so nominating across the line is choosing your
opponent's champion. `duelAct` refuses it, the phone's roster shows only your
team, and the board splits the pool into a column per side.

`flow:trivia*2,quizbowl*1:vote` builds a setlist of `mode*count` blocks; a
trailing `:rule` opens a duel each question for the block it follows, not
necessarily the last one. `jump:1` moves the flow to that block index. `clear`
drops a flow only when probe is the one that set it, the same rule as teams —
a host's own setlist survives a probe run against it.

With `wait:` between the steps that is a paced walkthrough you can watch on a
phone, and the two worth keeping are npm scripts rather than a paragraph to
retype: **`npm run walk-duel`** is ten players trading a nomination lead through
switches and withdrawals until it changes hands twice, **`npm run walk-teams`**
is the same in teams mode, where the seat has to reach past a same-team runner-up
and a wrong answer locks out a whole side. Both end in a `clear`.
`docs/manual-checklist.md` says what to watch for in each.

`join:Name` borrows a player of that name if one is already in the room (a
`fakes` entry, a real phone) rather than putting a second Ada on the board;
anyone it does mint gets a `probe-` id, which is the only thing `clear` kicks.
`clear` also cancels any duel, takes probe's players off the teams it put them
on, and returns the room to solo — but only if probe was the one that set teams
up, so running it against a host's own teams game leaves that alone.
Probe and the sim share `tools/conn.ts` — real sockets, real clock sync, no
shortcut through the HTTP layer.

`npm run motion` opens the animation harness — the only one of the three that
needs no server at all, because it is tuning CSS rather than exercising the
game. Pick an anchor, retrigger it or loop it, and drop the speed to 0.1× to
actually see where the light sits relative to the movement; a 110ms stamp is
eleven frames at full speed and there is nothing to judge in that.

Its numbers live in two blocks — `anim:tunables` in `client/style.css` for the
picture, `cue:recipes` in `client/cues.ts` for the sound — and **Save** rewrites
both in place through one dev-only Vite middleware, so a value you dialled in
cannot change on its way home. It is disabled until something has actually
moved, and says afterwards how much went to each file. The scenarios live in
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
with an envelope, and the panel shows them as a DAW would — every layer of a
cue on one shared timeline, the audio drawn behind the envelope that gates it.
Drag the track body to move a layer in time, drag within a few pixels of the
clip's left edge to slide the audio inside it, drag the four handles for the
envelope. The cursor and the caption under each track name the gesture before
you commit to it — the two body drags differ by six pixels and nothing else,
so the track has to say which one it is about to do. Audio past the envelope's
end is dimmed rather than cut, so the tail you gated off stays visible and
draggable back. `+ layer` adds a source —
an adopted file or one of five oscillators — and `×` removes one; both are
undone by Reset, because nothing is written until Save. Save writes the whole
`cue:recipes` block through the same endpoint that writes the CSS.

A layer may only name a file in `client/public/sounds/`, never one in
`sounds/raw/`: anything a recipe names has to be servable to the real board.
Using a download means adopting it first.

Sounds that must stay found live in `sounds/raw/`, which is gitignored — drop a
download in and it appears in the panel's Library, auditionable through the
current trim so you hear what you are about to bake in. Adopting runs one of two
`ffmpeg` presets, writes the result into `client/public/sounds/`, and appends
the row to `CREDITS.md` with the exact command. **Keep as a cue sound** bakes
the dialled head, cut and pitch into uncompressed mono PCM with a 40ms fade at
the cut — a sound that fires. **Keep as looping music** ignores the trim
entirely and transcodes the whole file to Opus — a bed is looped on its own
loop points rather than cut, and it is long enough that 64kbps is the
difference between a 17MB download and a manageable one. The output extension
follows from the preset rather than from what you typed, because ffmpeg picks
its encoder from the extension and Opus in a `.wav` container is not a file. `ffmpeg` is a machine
binary invoked through `child_process`; it is not and must not become an npm
dependency.

Before a real game night, walk `docs/manual-checklist.md`.
