# A setlist advises the room; it never plays

Entering a block applies its setup (mode, options, round value, a duel if declared) and stops: the host still arms, judges and moves on, which keeps the reader the only issuer of `arm`. `server/setlist.ts` is pure: the applier arrives as a parameter, which avoids an import cycle with `applyHostAction` and lets tests use a recording fake.

- `applySetup` (mode and value) is separate from `applyDuel` so `setSetlist` can re-apply setup when the block at a kept position changed shape without re-opening the duel, which would wipe an in-flight nomination pool. A change outside `sameSetup`, such as `count`, touches neither.
- Setup re-applies only when the block is fresh. Re-stamping the value every question would override the host's mid-block tweak and the pack's per-question `V:`.
- A duel block opens a duel on every question, fresh block or not.
- A spent setlist sits at its end and does not wrap; entering the end stamps `spentAt` for the finale and entering a block clears it.
- `sanitizeBlocks` drops a block naming an unregistered game or duel rule instead of failing the whole setlist, like a bad pack question. A minigame block is forced to one visit with no pack, value or duel. The pack is only a filename; the reader discovers a missing pack.

Where: `server/setlist.ts` (`applySetup`, `applyDuel`, `enterBlock`, `advanceSetlist`, `sanitizeBlocks`), `server/state.ts` (`setSetlist`, `sameSetup`)
