# Minigame review fixtures drive the real rules and refuse loudly

The Ink and Sketch review fixtures reach each frozen state by feeding inputs through the minigame's own definition (`makeInk`, `makeSketch`) rather than hand-building frames, so a preview cannot show a state the game could never reach. Any input the rules refuse throws with the player, input and reason, because a fixture that silently dropped an input would show a false state.

Where: `tools/review/ink.ts` (`InkGame.play`), `tools/review/sketch.ts` (`SketchGame.play`)
