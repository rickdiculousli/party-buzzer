# party-buzzer

A LAN buzzer for quizbowl, pub trivia, and Jeopardy nights. Host runs one
command; players join by scanning a QR code. The game itself is pure LAN —
nothing a phone renders is fetched from anywhere but the host.

## Run it

```bash
mise install     # Node 26.7.0
npm install
npm run build
npm start
```

The terminal prints a QR code and a join URL. Players scan it. `/host` and
`/board` open themselves on the machine running the server — drag the board
window to the TV. `NO_OPEN=1 npm start` if you would rather they didn't.

Ctrl-C closes them again — every Chrome tab pointing at the server, so a night's
worth of duplicated boards goes with it. macOS asks once for permission to
control Chrome; decline it and the tabs simply stay, which is what they did
before.

If several networks are detected, the server says which one it chose. Override
with `HOST_IP=192.168.1.42 npm start`. Change the port with `PORT=9000`.

### Why the join URL is a domain name

It reads `https://192-168-0-74.local-ip.sh:8080` rather than the bare address.
Spoken answers need microphone access, browsers only grant that on a secure
origin, and no certificate authority will issue for a LAN IP. `local-ip.sh`
resolves that name straight back to `192.168.0.74` and publishes a real
certificate for it, so phones get https with no warning screen and nothing to
install.

That needs working DNS **once, at startup** — the certificate is then cached in
`.cert/` and the game plays entirely on the LAN. Without it the server falls
back to plain http and says so: everything works except the microphone, and
players answer out loud for the host to judge.

## How a question runs

1. **Arm** — buzzers go live on every phone.
2. Players buzz. The first press starts a one-second collection window;
   everyone who buzzes inside it is ranked by when they actually pressed, not
   when their packet arrived. The provisional leader appears on the big screen
   150ms in and the timeline keeps filling as the room lands — a slow packet
   carrying an earlier press can still take the lead. Phones only ever see
   their own placement.
3. **Correct** awards the round value. **Wrong** applies a neg, locks that
   player (or team) out, and reopens the buzzers for everyone else.
4. **Next question** clears the lockouts.

## Direct play or a setlist

The host panel's Setup asks one question first, and shows only what the answer
needs. **Direct play** is you picking the game and the pack and driving by hand.
**Setlist** is a list of blocks, each carrying its own game, options, value,
duel rule and pack — the room walks it a question at a time and the pickers
disappear, because the block is what answers them. A block that names no pack
is one you read aloud yourself.

## Game modes

The host screen folds a Game section into "Game, players and teams": pick the
mode and its options there. The default is plain trivia — the game described above.

**Quizbowl-lite** adds powers (a faster buzz is worth more, while the power
mark is still up), negs, bouncebacks after a wrong answer, and item drops —
the winner's phone can hold a freeze, shield, or steal for a later round. A
mode is set per session; switching resets scores and the board.

Powers and fragments are driven by the host reading a question pack: put
`.txt` packs in `packs/`, pick one on the host screen, and press Read. Picking
a pack pre-renders every fragment to an audio clip, which takes a few seconds
the first time and is cached after that. **Autoplay** takes the two keypresses either side of your judgment: the answer
sits on the wall for however many seconds you set and then the next question
arms itself, a rebound waits its own pause before the clue picks back up, and a
question nobody buzzes passes on its own instead of hanging there. C and W are
still yours — unless the spoken-answer judge is on, in which case the pack
reads itself end to end.

A buzz cuts the voice mid-word and the rest of the clue is never read — a
correct answer ends the question there, a wrong one rebounds and the
interrupted fragment is re-read from its start. **Pause** does the same by
hand; buzzers stay live throughout, because the usual reason to pause is that
someone interrupted.
Speech needs macOS (`say`, `afplay`); without it the fragments still appear,
silently.

Fragments go up on the board as they are spoken. Phones see them only if you
tick "Mirror question text to phones" — off by default, and worth leaving off
for quizbowl, where reading ahead is the whole game.

Pack format, three lines per question: `V: 200` sets the value (optional; a
question without one leaves the round value where the last one put it), the
question text uses ` / ` to mark
where a fragment lands on the board, `A:` gives the answer, and a blank line
ends the question. A question with no `A:` is skipped with a warning naming the
line, so one typo costs one question rather than the pack. See
`packs/sample.txt`.

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
npm run sim        # fill the room with bots and play real rounds
```

`npm run sim` is the quickest way to see the board in motion. `npm run sim -- 5 2`
runs five questions at half speed, Ctrl-C removes the bots. You can join from a phone
and play against them.

Server code is native TypeScript — Node strips the types, there is no build
step. Relative imports therefore carry `.ts` extensions.

Game state lives in `state.json` beside the repo. Delete it to start fresh.

Before a real game night, walk `docs/manual-checklist.md` — it covers what no
automated test can reach.
