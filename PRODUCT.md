# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The host, players, and room audience are all essential to the experience. The host runs play from a control desk, players participate on their phones, and everyone follows the shared TV board.

## Product Purpose

Party Buzzer runs a shared party game night from one machine. The quiz and minigames are parts of one product. Success means the host can see progress and guide play confidently, the board makes each moment clear and engaging for the room, and phones give players equally clear and engaging ways to participate.

## Positioning

One local server coordinates the host desk, player phones, and room board. In the quiz it ranks buzzes using phone timestamps to reduce LAN jitter, then carries the same players and scores through modes, setlist blocks, and minigames.

## Operating Context

- A trusted LAN connects the host machine, player phones, and a TV browser. Players join through a QR code.
- The host runs play from `/host`; players use `/`; the shared display uses `/board`.
- The host can play directly or prepare a setlist of blocks. A block can select a quiz mode or a minigame, along with its options and question count where applicable.
- Question packs can be read aloud by the host or played through speech generated on the server machine. Spoken answers can be judged by the host, with optional transcription and automatic judging when available.

## Capabilities and Constraints

- Quiz play includes trivia and quizbowl-lite modes, shown and multiple-choice questions, team grouping, duels, items, scoring, rebounds, and standings. Bow, Tank battle, Phantom Ink, Sketch, and Poker are minigames in the same game night.
- The server owns game rules and scores. Browsers receive role-specific views; phones do not receive the full buzz order or private reader progress.
- Buzz timing accommodates network jitter among trusted clients. It is not designed to defend against dishonest clients.
- The application is for a trusted room. Host access has no authentication; a remote game service and a general plugin framework are outside the current product scope.
- Fonts, sounds, and browser assets are hosted locally. HTTPS supports phone microphone access when certificate setup and LAN DNS work; host judging remains available when microphone access does not.
- Saved state restores settings, players, scores, and setlist position, but a server restart does not resume an active question or minigame, except Poker, which resumes at the start of its last hand.
- Use the distinct terms in `docs/design.md` §9, especially question, round, attempt, block, setlist, order, standings, leader, and hero.

## Brand Commitments

The existing product name is Party Buzzer. Player-facing actions use direct game words such as “Buzz,” “Arm,” and “Remove.” Controls explain why an action is unavailable. The established writing guide uses sentence case and avoids apologies and exclamation marks.

## Evidence on Hand

- `README.md` documents setup and gameplay; `ARCHTECTURE.md` maps the current implementation; `docs/design.md` records the existing language and design system.
- `client/Host.tsx`, `client/Player.tsx`, and `client/Board.tsx` implement the three web roles.
- Question packs and sample setlists are local files; local fonts and credited sounds live in `client/public/`.
- The repository has simulation, motion, and frozen-state review tools for observing parts of the experience. Frozen previews do not prove timing, audio, microphone, or multi-device behavior.

## Product Principles

1. Give the host a clear view of progress, the room’s current moment, and the next valid action.
2. Make the board legible and engaging for the room, and the phone clear and engaging for each player.
3. Preserve one continuous game night across the quiz, setlist blocks, and minigames.
4. Favor reliable local play and understandable rules over remote services or account setup.
