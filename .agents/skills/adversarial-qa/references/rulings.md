# Rulings

Decisions Rick has made. A critic may point out a cost of one, but may not
report it as a defect or propose undoing it. When Rick makes a new call during
a review, add it here, dated, with the reason he gave.

## Sound

- **Cards landing on felt make no sound.** Nor do they when they come down
  after turning over. Only their travel through air is heard. (2026-10-01)
- **A card in flight is one low, soft whoosh**: a lowpassed swell with no
  hiss layer and no held level. A bright band or a steady noise floor reads as
  TV static on TV and phone speakers. Its length follows the card's actual
  flight. (2026-10-01)
- **Peeking makes no sound while the card bends.** Letting go makes one low,
  dull, barely audible puft. It is exempt from the loudness tiers because it
  was tuned by ear. (2026-10-01)
- **No "your turn" sound on the phone.** It was annoying. The shot clock's last
  ticks stay. (2026-10-01)
- **Loudness follows the tiers in `tools/loudness.ts`.** Hero −14, event −20,
  signal −26, foley −32, air −40 LUFS (loudest 100ms, K-weighted), set for the
  board; the phone plays everything 6dB down. (2026-10-01)
- **Hand-tuned anchors are never replaced or rescaled**: `stamp`, `type`,
  `award`, `penalty`, `leader`, `welcome`. New work wraps them. `leader` clips
  (+3dBFS peak); that is Rick's to decide.

## Look and motion

- **The design guide (`docs/design.md`) is the source of truth.** Where code
  and guide disagree, report the disagreement; don't pick a side silently.
- **The quiz is the style reference.** Bow and Tank are unstyled demos.
- **Minigames keep their own structure.** Align components and theming with
  the house, not the quiz's layout.
- **Poker is a real table under one lamp over the middle**: cards are thrown
  and pushed with friction, land loose and are tapped square, folds lie a
  beat then pop away, there is no discard pile. Realism serves the room's read
  of the game, not simulation for its own sake.
- **Motion is verified by pure maths and seeded simulation**, not repeated
  live runs. The filmstrip is a capture for critics, not a test harness.
- **Rick tests gestures and feel on his phone himself.** Critics can flag a
  feel risk, but leave confirming it to him.
