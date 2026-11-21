# Poker layout never moves under a thumb

- Pieces live in their own isolated layer, so a dealt card orders over chips but never rises above seats, floats or banners.
- The phone always lays out five board-card slots, so a new street never moves the cards already down or the pot.
- The raise amount has fixed grid rows, because a fraction glyph the display face lacks comes from a fallback font with taller lines and would nudge the slider.
- The raise slider and its stops are inset from the screen's sides, where an edge swipe changes apps.
- The raise sheet rises over the leather rail instead of replacing it, so the table above never moves; out of a hand the rail buttons fade but keep their place.
- The call painted on the felt always keeps its room, so the cards never move when it comes and goes.

Where: `client/style.css` (`.poker-layer`, `.poker-phone__board`, `.poker-sheet__amount`, `.poker-sheet__slider`, `.poker-rail--sheet`, `.poker-call`), `client/PokerPlayer.tsx`
