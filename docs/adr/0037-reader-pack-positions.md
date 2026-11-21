# The reader keeps a position per pack and stops at a spent one

The reader keeps an in-memory position per pack so a setlist block that returns to a pack picks up where it left off.

- A pack read to its end keeps its position past the last question, which is what makes a setlist stop there rather than wrap.
- `start()` (the host's Read) resets every spent pack, not only the current one, because under a setlist the pack the next block reaches may not be the one the read last left off in. `carryOn()` (a block starting under autoplay) does not.
- `nextPack` follows the setlist's current block; a packless block or a spent setlist returns undefined and the loop ends, never falling back to the hand-picked pack. A `next` that rolls into a block with another pack is picked up at the top of the loop.
- `rewind()` forgets every position; it exists only so scripted walkthroughs start from the same frame however the last run ended.

Where: `server/reader.ts` (`Reader.pos`, `start`, `carryOn`, `nextPack`, `rewind`, `run`)
