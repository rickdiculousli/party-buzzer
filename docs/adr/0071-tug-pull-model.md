# Tug of war pulls with fatigue-weighted taps averaged per connected member

Each tap is worth `1 / (1 + fatigue)`, and fatigue fades over `FATIGUE_MS` (150 ms); at a steady interval T a tap is worth `1 - e^(-T/150 ms)`. More taps always pull more, the pull per second levels off near seven, and for the same number of taps an even rhythm beats bursts. Taps are a flood, not commands: they are `continuous` inputs with no ack, applied in arrival order each step, and taps sent during the countdown (before the first step) do nothing.

A side pulls as the mean of its connected members, so an odd room or a dropped phone neither helps nor hurts a side by headcount. A side made of several teams paints itself in a colour the other side is not using.

Where: `server/minigames/tug/world.ts` (`pull`, `stepTug`, `splitSides`, `FATIGUE_MS`), `server/minigames/tug/definition.ts` (`classify`)
