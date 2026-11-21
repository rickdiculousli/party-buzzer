# Filmstrips step every stage animation on one shared clock

`tools/qa/filmstrip.ts` serves the motion harness on its own random port (so critics capturing at once do not collide), pauses every animation on the stage and sets them all to each sample time, so a frame is exactly what the room sees then. Easing is read from the first keyframe, because a CSS animation's curve lives on its keyframes and its effect timing reads `linear`. Shots crop to the felt or stage the scenario draws on, not the harness margins. The harness stage is a patch of felt, not the whole board, and sound is not captured: timing, audio and touch feel still need a person.

Where: `tools/qa/filmstrip.ts`
