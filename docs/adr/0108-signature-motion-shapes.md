# Signature motion shapes

- A batch of timeline marks lands as a run: each mark waits `--enter`, scheduled by the board so no two land closer than `--mark-stagger`, while the rail still plots each at its true millisecond. The animation needs `backwards` fill, or a delayed mark sits fully drawn until its turn.
- A mark's bloom and stamp are one gesture with no separate start; a glow burning during the fall washed out the movement, and one switching on after read as a second event. The bloom is a two-layer core and halo, because one ring reads as a border switching on.
- The hero's glow is at full power on frame one and only cools; a glow that ramps up reads as a second event however tight the timing.
- The press flash has no `to` frame, so it settles into whatever the mood class paints.
- The vote glow uses `drop-shadow`, because an emoji is a bitmap glyph that `text-shadow` cannot outline; the warm tint lives on `.votes` so this keyframe can own `filter` on each figure.

Where: `client/style.css` (`.timeline__mark`, `@keyframes fx-pin-flash`, `.board__hero`, `@keyframes fx-hero-glow`, `@keyframes fx-press-flash`, `@keyframes fx-vote-glow`)
