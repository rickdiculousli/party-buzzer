# A setlist advises the room; the Reader stays the only issuer of `arm`

Entering a block applies its setup (mode, options, value, a declared duel) and stops: the host, or the Reader with a pack, still arms, and the host still judges. Night automation under autoplay dismisses introductions, opens and closes matches and calls `reader.carryOn()`, but never arms a question itself, so one place owns arming, its cancellation and its pack position. `server/setlist.ts` takes its applier as a parameter, which avoids an import cycle with `applyHostAction` and lets tests pass a recording fake.

Where: `server/setlist.ts` (`applySetup`, `applyDuel`, `enterBlock`), `server/hub.ts` (`nightStep`), `server/reader.ts` (`carryOn`)
