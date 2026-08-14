# party-buzzer — Design

**Date:** 2026-08-14
**Status:** Approved, ready for implementation planning

## Purpose

A LAN buzzer system for quizbowl, pub trivia, and Jeopardy-style games. The
host runs one command on a laptop; players scan a QR code with their phones and
buzz in. The server decides who buzzed first, fairly, despite WiFi jitter, and
tracks scores.

Questions live outside the app — read aloud, on slides, or on a physical board.
The server handles buzzing and scoring only.

## Constraints

- Party WiFi often has no internet. Every asset — fonts, icons, sounds, the QR
  library — is bundled and served locally. No CDN references anywhere.
- No accounts, no installs, no room codes. A player joins by scanning and
  typing a name.
- Scale is ~20 phones on a home router.

## Stack

- **Server:** Node 20+, `node:http`, `ws`. TypeScript.
- **Client:** Vite + Preact SPA, three routes.
- **Shared:** a `shared/` folder of message types imported by both sides, so the
  protocol cannot drift.
- **Storage:** one JSON file.

Rejected: Bun (requires the host to install it), SvelteKit/Next (SSR is
worthless on a live-socket LAN app, and both need ejecting to a custom server
for WebSockets).

## Architecture

One Node process. It serves the built static bundle, holds authoritative game
state in memory, and runs a WebSocket hub at `/ws`. No other process, no
external service.

```
  phones ──ws──▶  ┌──────────────────────────┐
  host   ──ws──▶  │  party-buzzer (node)     │ ──▶ state.json
  board  ──ws──▶  │  state machine + hub     │
                  │  static assets           │
                  └──────────────────────────┘
```

Three client routes off one bundle:

| Route | Surface | Shows |
|---|---|---|
| `/` | Player phone | Name entry, then a full-screen buzzer |
| `/host` | Host laptop | Controls, buzz order, scores |
| `/board` | TV / projector | Scoreboard, buzz order, join QR |

## Onboarding

On boot the server enumerates network interfaces and picks the LAN IPv4,
preferring a private range. If several candidates exist (VPNs and Docker
bridges make this genuinely ambiguous), it prompts the host to choose. It binds
`0.0.0.0:8080` and prints the join URL, a terminal-rendered QR code (`qrcode`
package, ANSI block output), and the host/board URLs.

The same QR is displayed large on `/board`, so once the TV is up, latecomers
scan the screen instead of crowding the laptop.

After entering a name, the player taps once to ready up. That tap unlocks the
browser audio context — iOS requires a user gesture — so the buzz sound works
later.

The player page is a PWA with a manifest so "Add to Home Screen" works, but
installation is never required.

### Identity and reconnection

On first join the server issues an opaque `playerId`; the phone stores it in
`localStorage`. Every reconnect presents it, so a phone that locked its screen,
dropped WiFi, or reloaded returns as the same player with the same score.

A player who clears storage or switches phones becomes a new player. The host
can rename or remove from the panel.

## Buzz protocol

### Clock synchronization

On socket open, the client runs an NTP-style handshake: send `ping{t0}`, server
replies with its clock, client computes `offset = t_server - (t0 + t1)/2`. It
takes seven samples and keeps the median, discarding the samples with the worst
round-trip time — those are the ones most distorted by jitter. A lightweight
re-sample runs every 30 seconds to catch drift.

All timing is anchored to `performance.now()` monotonic time, so a phone
adjusting its wall clock mid-game cannot corrupt anything.

### Pressing the buzzer

The phone stamps the moment on `pointerdown`, not `click` — `click` waits for
release and costs roughly 50ms. It fires the message and immediately gives
local feedback: vibration, sound, and the button turning solid. The player
perceives an instant response even though the verdict is 150ms away.

### The grace window

The server runs a per-round state machine:

```
IDLE ──(host arms)──▶ ARMED ──(first buzz)──▶ COLLECTING ──(150ms)──▶ LOCKED
```

The first buzz to arrive starts a 150ms timer. Buzzes arriving during that
window are collected, not rejected. When the timer fires, the server sorts the
collected buzzes by offset-corrected timestamp and locks the order.

Each corrected timestamp is clamped to `[armedAt, arrivedAt]`. A buzz cannot
logically predate the question being armed, and cannot be later than when its
packet landed. This one clamp neutralizes both a badly synchronized clock and a
player who hand-edits their timestamp.

If a client's clock sync never completed, its offset is 0 and the clamp
degrades it to plain arrival order rather than breaking.

### What each surface sees

- **Board and host:** the full ordered list with deltas ("Sam +38ms").
- **Phones:** only their own position. First place sees "YOU'RE UP"; everyone
  else sees their rank and a locked button.

**Accepted tradeoff:** the winner is announced ~150ms after the first buzz.
Nobody perceives this as lag, because the buzzer already responded locally the
instant it was pressed. The window is configurable; ship 150ms.

## Game state

```ts
type State = {
  mode: 'solo' | 'teams'
  players: { id, name, teamId?, connected }[]
  teams:   { id, name, color }[]     // empty in solo mode
  scores:  Record<id, number>        // keyed by team id, or player id in solo
  round:   { value: number, phase: 'IDLE'|'ARMED'|'COLLECTING'|'LOCKED',
             armedAt, order: BuzzEntry[], lockedOut: id[] }
}
```

Scores key on team id in team mode and player id in solo mode. Buzzes always
identify the individual who pressed, even when the score attaches to a team.

Persistence is a single `writeFileSync` of the whole state, debounced 100ms, on
every mutation. On boot the server loads `state.json` if present. No database,
no migrations, no ORM.

## Host controls

The core loop is four buttons: **Arm**, **Correct**, **Wrong**, **Next**.

Arm opens the buzzers. When the order locks, the top name is highlighted.
Correct awards `round.value` and advances. Wrong adds that player — or their
whole team, in team mode — to `lockedOut`, optionally applies a negative, and
re-arms for everyone else.

That `lockedOut` array is what makes the system work for quizbowl rebounds and
Jeopardy alike, and it costs one field.

Also on the panel: point value stepper, manual score edit, rename/kick a
player, toggle solo/teams, reset round. Every action is one click. No modals
during play.

### Deliberately excluded

Per-question timers, wagering and Daily Doubles, buzz history statistics, and
an undo stack. Add timers first if a format needs them — a per-round countdown
broadcast over the same socket, roughly 40 lines.

## Failure handling

| Failure | Handling |
|---|---|
| Phone screen sleeps | Screen Wake Lock API held while the buzzer is active |
| Phone drops WiFi | Auto-reconnect with backoff; `playerId` restores identity and score |
| Server restarts | Reloads `state.json`; clients reconnect on their own |
| Host laptop closes | State survives; board holds its last render until the socket returns |
| Clock sync incomplete | Offset 0; clamp degrades that client to arrival order |
| Buzz arrives after lock | Silently ignored; the phone already shows "locked" |
| Duplicate player names | Allowed; board disambiguates, host can rename |

## Testing

The buzz resolver is a pure function — `(buzzes, armedAt, offsets) → ordered
list` — and carries the real risk. It gets a Vitest file covering:

- out-of-order arrival
- a lying timestamp, clamped away
- a zero-offset (unsynced) client
- simultaneous buzzes
- a buzz from a locked-out player

Alongside it, one integration test boots the server on an ephemeral port,
connects several real WebSocket clients with injected latency, and asserts the
announced winner is the one who pressed first in real time.

Phones get a manual checklist for what only hardware reveals: vibration, wake
lock, and audio on iOS — which requires a user gesture to unlock the audio
context, so joining includes a "tap to ready" step.

No component tests for the buzzer button, no E2E browser rig, no load testing.
