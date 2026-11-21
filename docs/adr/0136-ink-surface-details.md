# Phantom Ink surface details

- Lobby columns pad with empty seats up to `LOBBY_SEATS`, so the Join/Leave button holds still as players join and leave.
- The lobby button says one word (Join or Leave, with the team in its `aria-label`), because a wrapped "Join Moon" would stand taller than "Leave".
- The `#ink-px` pixel filter uses `userSpaceOnUse` measured in row units (the rows' 500-wide viewBox), so the pixel grid starts at the row's corner.
- The writer's "Stop — finish your letter" alert is always laid out and only hidden, so its appearance never moves the canvas under a writing finger.
- The writer's Done stays disabled until a guesser presses Stop, and reads "Done after Stop" while it waits.

Where: `client/InkParts.tsx` (`InkLobby`, `InkDefs`), `client/InkPlayer.tsx` (`InkPlayer`)
