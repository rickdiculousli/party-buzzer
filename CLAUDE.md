# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A LAN buzzer for quizbowl and trivia nights. Host runs one command, players scan
a QR code. See `README.md` for running it and `docs/design.md` for the design
system — that document is the source of truth for anything visual, and
`client/tokens.css` is what the components actually read.

**Before you name anything, read the glossary** — §9 of `docs/design.md`. One
word per thing, one thing per word; when prose there and code disagree, the code
is what gets renamed.

## Commands

```bash
npm start          # serve dist/ on :8080, print the QR, open /host and /board
                   # (NO_OPEN=1 to keep the tabs shut; Ctrl-C closes any Chrome
                   #  tab on the server's url — macOS/Chrome only, no-op elsewhere)
npm run dev        # Vite HMR; run `npm start` alongside it for the API
npm run build      # vite build -> dist/  (npm start serves this, not client/)
npm test           # node:test
npm run typecheck
npm run sim        # synthetic self-play against a running server
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct   # one scripted round
npm run walk-duel / walk-teams      # the two paced duel walkthroughs, ~1 min each
npm run walk-setlist # the paced setlist walkthrough, ~1 min
npm run walk-read  # a pack read by the box, spoken answers judged, ~90s
npm run walk-packs # a setlist crossing two packs and back, ~2 min
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
script globs, and it globs five places, not one: `server/`, `server/modes/`,
`client/`, `shared/`, `tools/`. Anything you run by hand against `server/*`
alone skips the cue, waveform, protocol and library tests.

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
and the two timing constants (`ARM_DELAY_MS`, `COLLECT_MS`) that both sides count
against. Read it first; it explains more than any other single file.

State flows one way. Clients send `ClientMsg`, the server mutates, then
broadcasts a whole `State` to everyone. There is no client-side game logic and
no partial update.

`shared/wall.ts` is the other half of the contract — not what the server says,
but what a surface may show while it says it. `Moment` is thirteen named states
in five families (`answer:` `verdict:` `duel:` `buzz:` `idle:`), returned in
priority order, and `wallOf` / `phoneOf` project it into what the big screen and
a phone each render. Three rules, all load-bearing:

- **Nothing in it reads `round.order`.** `viewFor` redacts that to the
  recipient's own entry, so a moment derived from it would differ per phone —
  and the one guarantee the file exists to give is that the wall and the phones
  never disagree about where the question is. `server/hub.test.ts` holds that
  with a parity test against a real `Hub`.
- **Nothing in it reads the clock or the DOM.** The three time-dependent facts
  (`open`, `settled`, `retired`) arrive as `Local`, which is what keeps it
  runnable under `node:test`.
- **Content and identity, never appearance.** A tone is `penalised`, not `red`;
  the stylesheet maps it.

`Wall`'s invariant is the point: exactly one of `hero`, `clue`, `nominations`,
`faceoff`, `call` is non-null. It replaced a seven-branch ternary and six
overlapping booleans on the board, which is where every display bug of
2026-08 came from. `shared/wall.test.ts` asserts it at every step of a walked
question. Design: `docs/superpowers/specs/2026-08-18-wall-boundary-design.md`.

- `server/hub.ts` — connections, buzz collection, broadcast, undo. Owns all
  round timing.
- `server/state.ts` — `applyHostAction` (the round state machine) and the
  debounced snapshot to `state.json`.
- `server/resolve.ts` — pure. Turns raw buzzes into a ranked order.
- `server/modes/` — game modules; the `GameModule` type itself lives in
  `shared/modes/types.ts`, and `client/modes/` is where one may override a whole
  surface. Hooks (scoring, power, item grants) are all optional; `trivia`
  defines none and is today's game. A module has no mid-session lifecycle — no
  start/stop hooks, no event bus — so switching games means a `setMode` reset,
  which is exactly what a setlist block does at its boundary (with `keepScores`).
  Solo vs teams is the `grouping`, a different switch entirely.
- `server/items.ts` — framework-level boons/sabotage (freeze, shield, steal),
  fired by players over the `act` channel and validated before they apply.
- `server/duel.ts` — heads-up duels (two-player face-offs). Framework-level,
  composes with any mode: selection rules are data in a catalog, entry rides
  the `act` channel, and enforcement is one `round.buzzable` check at the
  hub's buzz gate. A wrong answer narrows the buzzable to the other seated
  player, which is the whole rebound mechanic.
- `server/setlist.ts` — the setlist: an ordered list of blocks. It advises
  and never arms — entering a block applies its setup and stops, so the host
  still arms, judges and moves on. A block also names its own pack, which the
  setlist itself does nothing with: the reader reads `setlist.blocks[at].pack`
  off State each question, so crossing a block boundary switches packs without
  a new action or a hook.
- `server/setlists.ts` — saved setlists on disk, filenames in `State` like
  `packs`.
- `server/index.ts` — HTTP + WebSocket, serves `dist/`, routes `/`, `/host`,
  `/board` to the same SPA shell.
- `client/useSocket.ts` — the socket, the clock sync, and `useOpen`. Every
  surface goes through it.
- `client/{Player,Host,Board}.tsx` — the three surfaces, chosen by pathname in
  `main.tsx`.
- `tools/sim.ts` — bots that play real questions over real sockets.
- `server/reader.ts` — the question loop. Drives the hub through a synthetic
  host connection, so it uses the same messages a socket client would and the
  hub grows no reader API. It holds every pack a session touches in memory at
  once, with a read position per pack, which is what lets a setlist cross
  between packs and come back to one where it left off; a setlist's packs are
  all rendered before its first question, never at the boundary.
  `state.autoplay` is a record, not a switch —
  `{on, nextSec, reboundSec}` — and turns its two waits-on-the-host into dwells
  of host-set length: the payoff's N and the beat a miss holds the wall before
  its rebound opens. That second one is the reader's to open, not the verdict's
  — `wrong` sets `round.held` while the box is driving and the reader sends
  `rebound` after the beat, so the buzzers reopen when the room can see it
  rather than seconds earlier on a signal only the phones had. It
  also passes a question nobody buzzed, which is the only way the loop can be
  left unattended. The judgment itself is never automated here; that is the
  judge's.

  **It holds several packs at once.** Every pack read this session stays
  rendered in memory with its own position, so a setlist whose blocks name
  different packs (`SetlistBlock.pack`) crosses between them at a block boundary
  with no thirty-second synthesis stall mid-night, and a block returning to an
  earlier pack picks up where it left off. Clips are keyed by fragment text, so
  two packs sharing a line share the clip. Selecting a pack by hand still
  starts it from the top.
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
- `server/stt.ts` — spawns the Swift helper, one process per answer, and
  degrades to null (judge off) when the source or `swiftc` is missing.
- `server/net.ts` — LAN address discovery and the QR, filtering out docker
  bridges and VPN tunnels so the printed url is the party WiFi's.
- `client/{synth,peaks,wav,recorder}.ts` — the sound stack the harness below is
  a UI for. `synth` is cues-as-data and splits at the only seam that matters
  (`schedule` is arithmetic and testable in Node, `render` is WebAudio);
  `peaks` reduces a waveform to one min/max pair per pixel column; `wav`
  encodes mono 16-bit PCM because the browser codec lottery has no winner and
  SFSpeech reads WAV directly; `recorder` is buffered push-to-talk capture.
- `tools/sndlib.ts` — the pure half of the sound-library middleware: path
  safety, name rules, and exactly what ffmpeg gets told. Touches no disk, which
  is what keeps the Vite plugin over it a thin shell.

### The parts that are load-bearing

**The clamp.** `resolve.ts` trusts a client's claimed press time only within
`[armedAt, arrivedAt]`. It cannot predate the question opening or postdate its
own packet. That one line neutralises both a badly synced clock and a
hand-edited timestamp, and it is why ordering is by press time rather than
arrival. Do not loosen it.

**Scheduled arming.** `arm` sets `armedAt = Date.now() + ARM_DELAY_MS`; every
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
- **Boot must never touch the network from a test.** `e2e.ts` is the one caller
  that passes `tls: false`; the unit tests never boot a server at all, driving
  `Hub` directly. Anything new that does start one inherits the obligation.
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
the grouping, the teams and the assignments in one step, reusing a team of that name
if the room already has one and leaving the grouping alone if it is already teams —
`setGrouping` drops an open duel, so re-sending it to add one late player would
cancel the window you were about to watch.
`speak:Name=transcript` POSTs the transcript as `text/plain` into the judge's
verdict path, so a whole spoken round is one command; real audio is the
checklist's.

In a teams grouping a vote may only name someone on the voter's own side: the seat
takes one player per team, so nominating across the line is choosing your
opponent's champion. `duelAct` refuses it, the phone's roster shows only your
team, and the board splits the pool into a column per side.

`setlist:trivia*2,quizbowl*1:vote` builds a setlist of `mode*count` blocks; a
trailing `:rule` opens a duel each question for the block it follows, not
necessarily the last one. `jump:1` moves the setlist to that block index.
`clear` drops a setlist only when probe is the one that set it, the same rule as
teams — a host's own setlist survives a probe run against it.

With `wait:` between the steps that is a paced walkthrough you can watch on a
phone, and the two worth keeping are npm scripts rather than a paragraph to
retype: **`npm run walk-duel`** is ten players trading a nomination lead through
switches and withdrawals until it changes hands twice, **`npm run walk-teams`**
is the same in a teams grouping, where the seat has to reach past a same-team runner-up
and a wrong answer locks out a whole side. Both end in a `clear`.

**`npm run walk-read`** and **`npm run walk-packs`** are the reading pair, and
the only walkthroughs where the box drives: the first is one pack under
autoplay through a buzz that cuts the voice, a rebound, dead air and the pack
running out, every answer spoken aloud and judged by machine; the second is a
setlist crossing two packs and coming back to the first mid-pack, judged by
hand. They read from `packs/walk-c.txt` and `packs/walk-{a,b}.txt`, which exist
for them — short, and answer variants on every question. `walk-c` is the
multi-sentence one, long enough that its second question can be missed and then
taken two sentences into the rebound.

`say:Ada=the Pacific Ocean` is what makes walk-read spoken: `say` renders the
words to a cached clip and probe posts the clip as audio, so STT and
`server/match.ts` both run. `speak:` is still the text/plain shortcut past
them. Nothing renders twice — the clips cache like the reader's.

Both are repeatable rather than merely re-runnable, which took three things:
`rewind` (the reader's read positions are per pack and survive a Stop, so a
walkthrough has to forget them on purpose), `mode:` (a mode left in quizbowl
scores 250 where trivia scores 200), and `direct` (a direct-play script cannot
run in a room that is in setlist mode). The scores are asserted in
`docs/manual-checklist.md` — the same three numbers every run, or something
moved.

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

Bringing a new moment into the harness is four moves, and a moment is not
done until all four are made:

1. **The picture's numbers become custom properties** in `anim:tunables`. If
   the animation is JS-driven rather than a keyframe (a `setInterval` reveal),
   the number still lives there — read it with `parseTune` off the component's
   *own element*, never `document.documentElement`: the harness applies dialled
   values to its stage wrapper, and a property read at the root never sees them.
   (`markGap` takes a scope for the same reason.)
2. **The sound becomes a recipe** in `cue:recipes`, played with `play()` — not
   a new sample, not a new playback path. Recipes are what the Sound panel can
   show, and what Save can write back.
3. **A scenario** in `client/anim/scenarios.tsx` renders the real component
   inside its real container, with the lead-up frame holding everything but the
   new thing, a `subject` naming the moment, and dials addressing the
   properties from step 1 — never a number restated.
4. **A cue the component fires itself** (per chunk, per step, anything other
   than once on the trigger) goes on the scenario's `tune`, not its `sound`:
   the panel shows the layers and dials, the trigger stays silent, and
   `setDialled` makes the component's own `play()` calls follow the draft, so
   what the taps sound like is what the panel says.

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

## How to report back

The repo is past the size where reviewing it line by line is worth anyone's
time. Report outcomes, not diffs: what now works, what changed behaviourally,
what you verified and how, and anything that needs a decision. Don't paste code
blocks to explain a change already made, don't narrate the edit sequence, and
don't walk through implementation choices that have no consequence outside the
file. Name files and symbols so a change can be found; the code itself is in the
diff.

Exceptions, and they're real: show the code when the choice is genuinely a
judgement call and you want it made at the top, when a snippet is the shortest
honest way to say what a change does, or when asked. A tradeoff worth
surfacing is worth the paragraph — the rule is against narration, not against
substance.
