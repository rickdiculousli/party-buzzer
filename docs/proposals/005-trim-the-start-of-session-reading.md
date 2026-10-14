---
id: 005
title: Point AGENTS.md at the sections agents need, not whole guides
kind: token-cost
size: XS
judge: sonnet
status: building
lens: eng
proposed_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
proposed_on: 2026-10-13
built_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
branch: t3code/party-buzzer-proposal-round-1
host: k16
---

## Opportunity
Measured with `wc -c` on 2026-10-13: `CLAUDE.md` (a symlink to `AGENTS.md`) is 7,737 bytes and is loaded into every session. It then says to read `ARCHTECTURE.md` (28,503 bytes) and `README.md` (22,271 bytes), so a session that follows it starts with 58,511 bytes, roughly 15k tokens, before any task. Of the README, about 14.5 KB is player-facing rules (Play, five minigame sections, question packs); the parts an agent needs are "Saving and undo" and "Development", about 6.1 KB together. For UI work it adds `docs/design.md` at 57,582 bytes, of which the always-relevant §9 "Canon words" is 6,814 bytes and §5 "Components" alone is 23,417.

## Proposal
Change the second paragraph of "Scope and starting points" in AGENTS.md to point at sections: `ARCHTECTURE.md` whole (it is the component map and is already section-sized), `README.md#saving-and-undo` and `README.md#development` instead of the whole README, and for the design guide name the sections by task: §9 for any naming, §4 and §5 only when touching components or motion, §7 for surface layout. Keep the canon-words sentence. In: `AGENTS.md` only. Out: moving or splitting any guide, changing their content.

Judge: sonnet, because it rewrites one paragraph with the targets given.

## What you'll see
A non-UI session loads about 42 KB of guidance instead of 58 KB, around 4k tokens saved per session; a UI session skips §5 unless it edits components, another 23 KB. The README still reads whole for humans.

## Verification
`wc -c` on the named sections after the change, recorded in the commit message. `npm test` is unaffected.

## Risks and the alternative considered
Agents reading with a whole-file tool will still read all of README unless the pointer is explicit, so the paragraph must say "those two sections". Alternative: extract §9 to its own `docs/canon-words.md`; rejected for now because it splits the design guide for a 6.8 KB saving and breaks existing links.

## Needs from Rick
