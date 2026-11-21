# The review workbench shows surfaces at the size a real browser lays them out

- The board renders in a frame filling the whole window, so a frozen state looks exactly as `/board` would at that size; the notes and phone drawers slide over it rather than taking width from it, since a resized board would be reviewing a layout the room never sees.
- Phone previews use flagship phones' CSS-pixel viewports and scale as a whole to fit the window, never reflowing.
- A delayed note focus never takes focus back from an input someone has started typing in, such as the Codex conversation field.
- Submitting a batch times out, because a dev-server restart during capture leaves the request hanging forever.

Where: `client/review/review.css` (`.review__board`, `.review__drawer`), `client/review/main.tsx` (`PHONES`, `focusNote`, batch submit)
