# Host desk layout rules

- The "up" strip naming who Correct and Wrong land on is dim until judging opens, so a lit name means the keys are live.
- The judging notes always reserve two lines, so the keys under them never move.
- A setlist that asks for more questions than the pack has shows tungsten, not tally: it is something to notice before the night, not something wrong with the room.
- Direct play versus setlist is two buttons rather than a checkbox: neither is the default, and the pressed one answers the question the panel asks.
- A setlist block's reorder and remove buttons sit at `margin-left: auto`, not behind a spacer element, which only pushed right while it shared a line.
- The tabs take the eyebrow treatment, not the button one: they say where the host is, not something done to the room.
- Chromium wraps a `details` element's children in `::details-content`, so the fold's grid gap is set there too.
- In a game fold the control row is fixed at a stepper's height, so steppers and toggles keep one rhythm.

Where: `client/style.css` (`.host__up`, `.host__notes`, `.setlist__tally`, `.host__pick`, `.setlist__acts`, `.host__tabs`, `.host__manage::details-content`, `.host__game .field`)
