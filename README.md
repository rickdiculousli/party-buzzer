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
2. Players buzz. The first press starts a 150ms window; everyone who buzzes
   inside it is ranked by when they actually pressed, not when their packet
   arrived. Phones only ever see their own placement.
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

Server code is native TypeScript — Node strips the types, there is no build
step. Relative imports therefore carry `.ts` extensions.

Game state lives in `state.json` beside the repo. Delete it to start fresh.

Before a real game night, walk `docs/manual-checklist.md` — it covers what no
automated test can reach.
