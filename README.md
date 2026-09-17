# party-buzzer

A browser-based buzzer for trivia and quizbowl nights on a trusted LAN. One
machine hosts the game; players join on their phones by scanning a QR code.
The host controls play at `/host`, and `/board` is the shared screen for a TV.

## Run

```sh
mise install          # pinned Node version
npm install
npm run build
npm start
```

The terminal prints the join URL and QR code, and opens the host and board.
Use `NO_OPEN=1 npm start` to suppress opening tabs. On macOS, Ctrl-C also tries
to close Chrome tabs pointing at this server; that requires permission to
control Chrome.

Players and the server must be able to reach each other on the network.
Override the selected LAN address with `HOST_IP=192.168.1.42 npm start`, or the
port with `PORT=9000 npm start`.

The server normally uses an HTTPS address such as
`https://192-168-1-42.local-ip.sh:8080`. It obtains and caches the shared
wildcard certificate in `.cert/`; phones need working DNS to resolve the name
to the LAN address. HTTPS enables browser microphone access. If certificate
setup fails, the server falls back to HTTP; use spoken answers judged by the
host when phone microphone access is unavailable.

Game traffic and browser assets come from the host. Fonts and sounds are local.
This is a trusted-room application: host access is not authenticated, and the
certificate is a browser convenience, not an access-control boundary.

## Play

1. Join from phones, then choose direct play or a setlist in host Setup.
2. **Arm** schedules the buzzers to open together. The first accepted buzz
   starts a one-second collection window; a provisional leader appears after
   150 ms and can change as more packets arrive.
3. Judge **Correct** or **Wrong**. Correct awards points; wrong applies the
   configured penalty and lockout. Depending on mode and playback settings,
   play reopens immediately or after a rebound pause.
4. **Next question** clears the question's lockouts and advances a setlist.

Phones estimate server time and timestamp the press locally. The server clamps
that timestamp between opening and arrival, then ranks presses. This reduces
network-jitter effects; it assumes honest clients. Phones receive their own
placement and the total buzz count, rather than everyone's timing.

**Trivia** provides ordinary scoring. **Quizbowl-lite** adds configurable powers,
negs, bouncebacks, and optional item drops. Freeze, shield, and steal live on
players' phones. Teams and duels are separate features that compose with modes.
Changing modes normally resets scores; setlist transitions can preserve them.

A **setlist** is a sequence of blocks, each choosing a game, options, value,
duel rule, question count, and optionally a pack. A block without a pack is
read aloud by the host. Saved setlists are JSON files in `setlists/`.

### Bow minigame

Bow is available as a freehand mechanics preview. Join every player before the
match, open `/board`, then press **Prepare Bow** and **Start match** on `/host`.
On a phone, drag down in the bow control and release. Every phone fires into the
same server-authoritative field; target points are added to the normal scores
once the 40-second match and three-second landing grace finish.

Players who join after the host starts spectate until the next match. The host
can cancel without awarding, replay from results, or return to quiz play. Bow
setlist blocks and final visual styling are not implemented yet; the current
shapes are placeholders for testing aim, release, flight, collisions, scoring,
and simultaneous play.

### Tank minigame

Press **Prepare Tank** and **Start match** on `/host`. Start pairs connected
players into random two-person crews; an odd player out drives and guns a tank
alone. Both players turn their phones sideways and tilt the phone's long edge
left or right. The driver tilts to turn the hull and holds Forward or Back; the
gunner points the on-screen dial where they want to fire, holds Gun, and taps Cannon. On iPhones, tap
**Enable tilt** when prompted. Hold the phone with its speaker/top end on the
left and charging-port end on the right; the play view compensates when screen
rotation is locked. A solo crew's tilt turns only the hull and its turret stays
pointed straight forward. The turret turns with the hull, so crews have to
coordinate their aim. Shots carve the cover, destroyed tanks respawn after
three seconds, and each crew's damage and kill points are added to both members'
scores when the match ends.

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
then Win or Not it. While their team votes, a Guesser tapping an option (Ask,
Guess, a prompt card, a row to peek) shows a named ring on teammates' phones,
and on the board for peek rows; taps anywhere else do nothing. The game has no clock. A server restart
or Undo during play returns it to ready and the game is lost.

`npm run sim-ink` plays a bot game against the running server (join a phone as Ivy, Jax, Kai, Tia (Sun) or Lux, Mo, Rex, Sol (Moon) first to watch that bot's view; Ivy and Lux write, and the Guessers tap the options they vote on, split votes and Force); `npm run sim-ink -- 2500` slows the bots to one round of actions every 2.5 s (default 700 ms).

## Question packs and spoken play

Put `.txt` files in `packs/`, select one, and press **Read**. For example:

```text
V: 200
This state's capital is Montpelier. / It is known as the Green Mountain State.
A: Vermont | VT

Which ocean is largest?
A: Pacific Ocean | the Pacific
```

Blank lines separate questions. `V:` is optional; omitting it keeps the current
round value. ` / ` separates fragments, and additional text lines continue the
current fragment. `A:` is required; ` | ` separates accepted answer variants.
The first variant is displayed as the answer. An optional `I: images/tower.jpg`
line attaches a picture (a path inside `packs/`). The board shows it when the
question arms; phones show it only with the mirror on. Invalid questions are
skipped with diagnostics. See [the sample pack](packs/sample.txt).

Selecting a pack starts background speech preparation and caching. Each
question waits for its audio before arming; the entire pack does not have to
finish rendering first. The board reveals the clue as it is read. Phones see
question text only when **Mirror question text to phones** is enabled.

A buzz interrupts playback. A rebound resumes at the interrupted clause when
alignment and seeking are available, or uses the available playback fallback.
**Pause** stops speech while leaving buzzers available. **Autoplay** handles
verdict dwell, rebound pauses, and advancing through questions. With spoken
answer recognition available, the judge can also apply verdicts automatically.
The host can still judge manually.

Local speech uses macOS tools and optional Swift helpers. Without speech
support, text still progresses silently. Browser cues play separately on the
phones and board; the question voice plays on the server machine.

## Saving and undo

`state.json` stores versioned game settings, players, teams, scores, inventories,
and setlist position. Existing unversioned snapshots are also supported.
Restart begins with an idle round and disconnected players until they reconnect.
It does not resume a question, answer deadline, audio, or the reader's per-pack
cursor. A saved setlist position is not a complete playback checkpoint.

Undo keeps up to 20 applied host-action snapshots in memory. It preserves live
connections and newly joined players, stops automated reading, and invalidates
old answer attempts. A restored settled leader can be judged manually; an
unfinished collection reopens because its original timers and packets are gone.
Refused actions and unchanged settings do not consume an undo step. Playback
controls and other runtime updates are not all undoable.

To start with no saved game, stop the server and remove `state.json`. Older
pre-rename `flows/` directories must be renamed to `setlists/` manually; this is
separate from snapshot version support.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run motion         # standalone visual/audio workbench at /anim.html
npm run dev            # Vite HMR; see proxy limitation below
```

The server runs native TypeScript directly. Relative source imports use `.ts`.
`npm start` serves `dist/`, so rebuild after client changes and restart after
server changes.

The current Vite proxy expects a **plain HTTP backend on port 8080**, and proxies
only `/ws` and `/qr.svg`. A normal HTTPS server is not interchangeable with
that backend, and `/spoken` is not proxied. Use the built server URL for full
phone and microphone testing. The [architecture guide](ARCHTECTURE.md#development-and-validation)
includes a local HTTP backend recipe for HMR work.

With a game server running:

```sh
npm run sim -- 5 2
npm run sim-bow -- 3 20
npm run sim-tank -- 3 30
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct
```

These tools change the live room. The `walk-duel`, `walk-teams`, `walk-setlist`,
`walk-read`, `walk-packs`, and `walk-images` scripts exercise longer flows. Start with
`TRACE=1 npm start` to record `trace.jsonl`, then inspect it with `npm run trace`.
Before a game night, follow the [manual checklist](docs/manual-checklist.md)
on actual phones and the room's audio setup.

## Repository guides

- [ARCHTECTURE.md](ARCHTECTURE.md): components, wiring, state ownership, and extension points.
- [AGENTS.md](AGENTS.md): shared instructions for coding agents.
- [CLAUDE.md](CLAUDE.md): Claude entrypoint to the same guidance.
- [Design system and vocabulary](docs/design.md): visual rules and canonical terminology.
