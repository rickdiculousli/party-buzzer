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
with `HOST_IP=192.168.1.42 npm start`. Change the port with `PORT=9000`.

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

## Game modes

The host screen folds a Game section into "Players and teams": pick the mode
and its options there. The default is plain trivia — the game described above.

**Quizbowl-lite** adds powers (a faster buzz is worth more, while the power
mark is still up), negs, bouncebacks after a wrong answer, and item drops —
the winner's phone can hold a freeze, shield, or steal for a later round. A
mode is set per session; switching resets scores and the board.

Powers and fragments are driven by the host reading a question pack: put
`.txt` packs in `packs/`, pick one on the host screen, and press Read. Speech
needs macOS (`say`, `afplay`); without it the fragments still appear, silently.

Pack format, four lines: `V: 200` sets the value (optional), the question text
uses ` / ` to mark where a fragment lands on the board, `A:` gives the answer,
and a blank line ends the question. See `packs/sample.txt`.

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
