# Editing a setlist keeps the night's position

- `setSetlist` keeps the current block and its progress when the room is mid-setlist and the new list still reaches that block, so editing a later block does not restart the night. A list too short for the current position, or a spent setlist (`at === blocks.length`, never a block anyone entered), starts over.
- When the position is kept but the block at it changed (`sameSetup`), only its setup is reapplied so the room's mode matches the play strip. Its duel is never reopened: a duel is a per-question event, and firing it on a settings tweak would wipe an in-flight vote pool.
- A fresh start forgets the previous question (its award must not resurface or count toward the first block on Next), enters block 0, and introduces it after setup and any duel window, replacing a lobby. A kept position leaves a pending introduction alone.
- `clearSetlist` removes only the plan; the game in progress, its mode and any duel being voted stay.

Where: `server/state.ts` (`mutateHostAction` cases `setSetlist`, `clearSetlist`; `sameSetup`), `server/setlist.ts` (`enterBlock`, `introduceBlock`, `applySetup`)
