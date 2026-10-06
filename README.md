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

**Open lobby** (host Play desk, in a quiet room) puts a Test buzzer on every
phone and the board. A press only lights that player's name on the board and
marks them tested; it scores nothing, never starts a round, and nothing waits on
it: **Arm** or **Close lobby** moves on whether or not anyone tested. The lobby
is runtime only, so undo does not bring it back and a restart drops it.

A fresh setlist clears the last question and opens its first block with an
introduction (board and phones say what the block is, in a line). It appears for the first block only; **Continue**
dismisses it. While it is up, Arm, Read, and opening a minigame are refused, and
the host desk says so. Next, reset, jumping, and clearing the setlist also drop
it. Undo can restore an introduction, under a new id, so a stale Continue is
refused. A restart does not restore one.

Phones estimate server time and timestamp the press locally. The server clamps
that timestamp between opening and arrival, then ranks presses. This reduces
network-jitter effects; it assumes honest clients. Phones receive their own
placement and the total buzz count, rather than everyone's timing.

**Trivia** provides ordinary scoring. **Quizbowl-lite** adds configurable powers,
negs, bouncebacks, and optional item drops. **Pure buzzer** is only arm, correct,
and wrong: no points, no lockouts, and a wrong reopens the question to everyone
as often as it takes. The host desk drops everything but those keys and the
buzz order; the board stays blank except for names and a Correct!/Wrong! stamp, and a missed name stays up
until the next buzz or reset. Freeze, shield, and steal live on
players' phones. Teams and duels are separate features that compose with modes.
Changing modes normally resets scores; setlist transitions can preserve them.

A **setlist** is a sequence of blocks, each choosing a game, options, value,
duel rule, question count, and optionally a pack. A block without a pack is
read aloud by the host. Saved setlists are JSON files in `setlists/`.

### Bow minigame

Bow is available as a freehand mechanics preview. Join every player before the
match, open `/board`, then open **Bow** on the host's Games tab and press **Start match** on Play.
On a phone, drag down in the bow control and release. Every phone fires into the
same server-authoritative field; target points are added to the normal scores
once the 40-second match and three-second landing grace finish.

Players who join after the host starts spectate until the next match. The host
can cancel without awarding, replay from results, or close it. A setlist block can name
Bow (or any minigame); closing it moves the setlist on. Final visual styling is
not implemented yet; the current
shapes are placeholders for testing aim, release, flight, collisions, scoring,
and simultaneous play.

### Tank minigame

Open **Tank battle** on the host's Games tab and press **Start match**. Start pairs connected
players into random two-person crews; an odd player out drives and guns a tank
alone. Both players turn their phones sideways. The driver points a dial where
the tank should head and holds Forward or Back; the hull swings toward that
heading at a steady pace, and faint rails beside the tank on the board show the
heading it is turning to. The gunner points their own dial where they want to
fire, holds Gun, and taps Cannon. Hold the phone with its speaker/top end on the
left and charging-port end on the right; the play view compensates when screen
rotation is locked. A solo crew's dial steers only the hull and its turret stays
pointed straight forward. The turret turns with the hull, so crews have to
coordinate their aim. Shots carve the cover, destroyed tanks respawn after
three seconds, and each crew's damage and kill points are added to both members'
scores when the match ends.

### Phantom Ink minigame

Transcribe your own Phantom Ink cards into `packs/phantom-ink.txt` (gitignored):

    P: What is it made of?
    W: Apple | Calendar | Snowman | Chili | Fox | Table

`P:` lines are prompts (at least 16); `W:` lines are word cards of six words.
Open **Phantom Ink** on the host's Games tab. Every phone picks Sun or Moon, and
anyone on a team may volunteer to write; the board shows both teams and turns a
count red when a team is over half the room. **Start match** needs everyone
picked and two per team, then draws each team's Writer from its volunteers.

Writers agree on the secret word from a shared word card. Guessers vote on
every team choice (Ask or Guess, which two prompts, which clue to peek, Redraw
hand); a choice applies when all of a team's Guessers agree, or when one of
them holds Force for two seconds. Writers write freehand in the team's row and
can undo only their latest stroke. Writing screens are sideways: hold the
phone with its left edge down (autorotation is fine). Ink may run past the
writing box; the board clips it to the row. Guessers tap Stop; the Writer finishes the
letter and taps Done, or taps End clue to add the period. A guess is typed one
letter at a time on the first Guesser's keyboard: each letter goes straight to
the server, which checks it against the secret word, wins the game on the last
letter and ends the turn on a wrong one. The Writer never judges a guess. While their team votes, a Guesser tapping an option (Ask,
Guess, a prompt card, a row to peek) shows a named ring on teammates' phones,
and on the board for peek rows; taps anywhere else do nothing. The game has no clock. A server restart
or Undo during play returns it to ready and the game is lost.

`npm run sim-ink` plays a bot game against the running server (join a phone as Ivy, Jax, Kai, Tia (Sun) or Lux, Mo, Rex, Sol (Moon) first to watch that bot's view; Ivy and Lux write, and the Guessers tap the options they vote on, split votes and Force; a guessing bot spells half the word, misses its team's first guess and wins on the second). A team with a borrowed phone types its own guesses: the bots play everything else but never send a letter, so the row stays open for you; `npm run sim-ink -- 2500` slows the bots to one round of actions every 2.5 s (default 700 ms).

### Sketch minigame

Open **Sketch** on the host's Games tab and press **Start match**; it needs two
connected players. Each turn one player draws: their phone offers three words
(the first is taken after 10 seconds), and they draw sideways, holding the
phone with its left edge down as Ink's writers do, with Undo, plus Clear and
Pass, which both take a hold. The drawing appears live on the board, beside the
match's standings. Everyone else types guesses: they join the feed under the
drawing, a guesser's own last misses stay on their phone, a guess one letter off
shows **Close** on that phone only, and a right one shows its place and time. A
letter is revealed at half time and another at three quarters. The turn ends
when everyone has it, when time runs out, or on Pass, and the board stamps how
many got it and shows the word. The match's points join the night's standings
when it ends.

A right guess scores 50 plus up to 50 more for time left; the drawer scores up
to 100 for how many got it. **Draw seconds** (default 80) sets the draw time and
**Drawers** limits the turns (0 = everyone once, so a short setlist block can
set 4). Words come from `packs/sketch-words.txt`, one per line; a match needs
three per connected player and never offers a word twice. Every moment has a
sound cue, placeholders for now.

`npm run sim-sketch` plays a match with eight bots against the running server;
`npm run sim-sketch -- 300` speeds them up.

### Poker minigame

No-limit Texas Hold'em, one table, played down to the last stack. Open **Poker**
on the host's Games tab and press **Start match**; it needs two connected
players, and everyone connected at Start takes a seat (no late entry, no
rebuys). The board is the table: seats, bets, the pot, the cards on the felt,
and a feed of every action. Each phone is a small felt table holding that
player's two cards, face down until pressed:

- **Fold:** flick the cards up off the top of the phone. On the board they fly
  toward the middle, lie where they stop for a beat, and pop away.
- **Check or call:** double tap the felt. The line at the bottom says which,
  and how much.
- **Peek:** drag up from below the dashed line on the felt (just above the
  bottom of your cards) and the pair's bottom edge bends up from under your
  finger, both cards together, levered: a short drag lifts it a long way. Let go
  to lay it down. These drags always peek and never fold, so you can look again
  and again; flick from above the line.
- **Raise** and **All in** are buttons; Raise opens a slider with ½ pot, pot and
  all-in presets.
- **Reactions** (Nice hand, Ouch, Bluff?, Wow) float up from your seat, one
  every 3 seconds, busted players included.

A shot clock acts for a slow player: it checks when that is free and folds
otherwise. A disconnected player keeps the seat, and their clock is 2 seconds.
Blinds double every level. When everyone else folds, the winner has a few
seconds to Show. When no more betting is possible, every hand turns face up and
the board deals the rest slowly with each player's win %.

Options: **Starting stack** (1500), **Starting big blind** (20), **Minutes per
level** (10) and **Shot clock seconds** (30). Poker never touches the night's
scores; results are finishing places.

A tournament survives a restart. Poker saves a checkpoint as each hand begins,
and after a server restart, or after **Cancel match**, the host's Start reads
**Resume from hand N**: that hand is dealt again from the same stacks. Opening
Poker again from the Games tab starts a new tournament.

`npm run sim-poker` plays a fast tournament with six bots against the running
server (Fay never acts, so her shot clock plays her hands) and checks that no
chip appears or vanishes; `npm run sim-poker -- 150` speeds them up. Ctrl-C
clears the Poker session, checkpoint included. `npm run sim-poker -- solo` plays heads-up
against your phone: join first, then one bot takes the other seat at the default
options and bets and raises often, from half the pot to two and a half pots, so overbets
come up; `npm run sim-poker -- solo 3000` slows it down.

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
skipped with diagnostics. See [the sample pack](packs/sample.txt), and
[the question styles](docs/question-styles/README.md) for how to write them.

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

A question can also be **shown** or **multiple choice**; one pack can mix all
three. `K: shown` puts the whole question on the board at the arm while the
voice still reads it, and buzzing works as usual. A `C: Mars | Venus | Saturn`
line makes a multiple-choice question: the voice reads the question, the
choices appear on the board and phones, the voice reads them, and every
player picks once. Picking closes when everyone has picked or **Choice time**
runs out after the options are read (the host can also press **Close
picking**). Every right pick scores the round value; a wrong one costs
nothing. `A:` must equal one of the choices. Shown and choice text reaches
phones whatever the mirror setting. See [the mixed pack](packs/mixed.txt).

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` and ElevenLabs v3 reads the
questions instead of `say`; the host's pack picker shows what each pack still
costs to render, and a rendered line is cached and never billed again. With it
set, an `S:` line gives a question a performed read —
v3 audio tags, CAPS stress, stretched words, ad-libs — spoken in place of the
fragments, which still go up on the board in time with it. The script must
say the fragments' words in order; anything around them is stepped over.
`say` ignores it.

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
npm run poker:prints   # regenerate peek prints after card art/token/font changes (Chromium + cwebp)
npm run review         # frozen board/phone review workbench at /review.html
npm run review:serve   # same workbench on 127.0.0.1:4174, without opening a browser
npm run loudness       # every cue against the loudness tiers; -- --apply rescales off-tier cues
npm run qa:motion      # Poker moves as numbers (card widths/s, spin, air time) with physics flags
npm run qa:sound       # each cue's loudness, envelope, spectrum and phone-speaker share
npm run qa:film -- poker-flop   # motion-harness scenario as a contact sheet in .qa/ (--list for ids)
npm run dev            # Vite HMR; see proxy limitation below
```

The `qa:*` commands are the evidence for the `adversarial-qa` skill
(`.agents/skills/adversarial-qa/`), which sends critic agents at motion, visual
and sound changes before they are called done.

The server runs native TypeScript directly. Relative source imports use `.ts`.
`npm start` serves `dist/`, so rebuild after client changes and restart after
server changes.

The current Vite proxy expects a **plain HTTP backend on port 8080**, and proxies
only `/ws` and `/qr.svg`. A normal HTTPS server is not interchangeable with
that backend, and `/spoken` is not proxied. Use the built server URL for full
phone and microphone testing. The [architecture guide](ARCHTECTURE.md#development-and-validation)
includes a local HTTP backend recipe for HMR work.

The review workbench is a development-only way to comment on frozen board and
phone states and hand those comments to a coding agent. Install its browser once
with `npx playwright install chromium`, then run `npm run review`. The board
fills the whole window, so it renders at the proportions `/board` has in that
window; put the window in full screen for a TV. The **Notes** tab on the left
edge pulls out the scenario and phone pickers and the notes; the **Phone** tab on
the right pulls out the phone at a flagship's CSS screen size (iPhone Pro Max,
Galaxy S Ultra or Pixel Pro, picked from the buttons beside it), scaled down whole if the window is
shorter; a real phone's browser toolbars take some of that height. Both slide over the board and remember whether they were open. Choose a
scenario and phone, click an element in either preview (the notes drawer opens),
and write a suggestion.
**Send** saves an immutable local bundle under ignored `.review/batches/` and
captures the referenced previews. The status changes as the agent acknowledges
the batch and marks it ready or blocked. Clicking an element that already
has an open note returns to that note instead of opening a second box. Sent notes
leave the editable list at once, so a second **Send** cannot resubmit them, and
they fold under **Done** carrying their batch id, and the agent's outcome and
closing summary once it reports. The delivery strip clears itself then, and can be
dismissed at any point. **Reopen** puts
one back in the list and **Clear done** discards them. **Refresh previews**
remounts the same frozen state after source edits while retaining draft notes.

How the bundle reaches the agent depends on `CODEX_THREAD_ID`. With it set, the
workbench asks for the exact Codex conversation UUID and queues the bundle path
straight to that conversation; a queue timeout is shown as `delivery-uncertain`
and a confirmed command error as `delivery-failed`. The adapter was exercised
with `codex-cli 0.154.0`. Without it — Claude Code and everything else, since no
other CLI can append a message to a live session — Send copies the handoff line
to the clipboard and shows it for manual selection. Paste it into the agent and
press enter.

These static views are for visual review; use the manual checklist for timing,
audio, microphone, and multi-device behavior.
The QR in a frozen board preview is a visual placeholder and cannot join a live room.

Coding agents can explicitly invoke the repository skill as
`$review-workbench` in Codex or `/review-workbench` in Claude Code. They may
also select it from a natural-language request to inspect or annotate board and
phone states. The skill handles launch and incoming batch reports, and asks the
agent to propose a concrete workbench or script improvement when a normal review
path required repeated manual or LLM-mediated steps.

With a game server running:

```sh
npm run sim -- 5 2
npm run sim-bow -- 3 20
npm run sim-tank -- 3 30
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct
```

These tools change the live room. The `walk-duel`, `walk-teams`, `walk-setlist`,
`walk-read-quizbowl`, `walk-read-trivia`, `walk-packs`, and `walk-images` scripts exercise longer flows. Start with
`TRACE=1 npm start` to record `trace.jsonl`, then inspect it with `npm run trace`.
Before a game night, follow the [manual checklist](docs/manual-checklist.md)
on actual phones and the room's audio setup.

## Repository guides

- [ARCHTECTURE.md](ARCHTECTURE.md): components, wiring, state ownership, and extension points.
- [AGENTS.md](AGENTS.md): shared instructions for coding agents.
- [Design system and vocabulary](docs/design.md): visual rules and canonical terminology.
