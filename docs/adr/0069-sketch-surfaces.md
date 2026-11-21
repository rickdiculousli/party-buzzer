# Sketch's board and phone screens

- The board keeps the quiz's frame (stage plus standings), and every phone screen keeps the quiz phone's blocking: identity bar, one centred line for the countdown, a card in the middle, actions below.
- The drawer draws sideways with the phone's left edge down, as in Ink, so the 4:3 drawing gets the phone's long side.
- The drawer's canvas sends the live stroke every 50 ms and commits on lift, showing its own draft until the server has processed every stroke, undo and clear sent.
- Only Undo acts on a tap; clear and pass take a hold of a quarter of Ink's Force hold, long enough not to slip mid-drawing.
- Frames carry strokes only when they change (and once a second), so `useSketchStrokes` keeps the last set.
- The first turn's cue fires on the first step, because countdown frames hold tick 0.
- Around the drawing (guessing, got it, the reveal) the card holds only the drawing and the word, and the field sits right under it near the phone's middle, so the on-screen keyboard opens below the field and the result lands where the field was; a trailing flex spacer is the keyboard's space. On a phone that shrinks the page for its keyboard, the drawing shrinks (`min-height: 0`), never the field.
- Guessing keeps the keyboard up: the field is focused without scrolling, Send never takes focus, and only the guess form lifts by the keyboard's overlap (`useKeyboardLift`, measured net of the form's current lift because the form is a new element each turn), with any page pan undone. The player's own last misses stay in view so a cleared field reads as sent.

Where: `client/SketchBoard.tsx`, `client/SketchPlayer.tsx` (`Screen`, `SketchPlayer`), `client/SketchParts.tsx` (`useSketchStrokes`, `SketchCanvas`, `useKeyboardLift`, `focusInPlace`), `client/sketch.ts` (`sketchCues`), `client/style.css` (`.sketch-phone--tight`)
