---
id: 024
title: Move Poker rendering prose out of Canon words and the architecture map
kind: token-cost
size: S
judge: sonnet
status: proposed
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
Measured with `wc -c` on 2026-10-14 at `6f20bf2`. AGENTS.md (7,859 bytes, loaded every session as `CLAUDE.md`) sends every naming task to `docs/design.md` §9 "Canon words": 6,836 bytes, of which 2,881 (42 %) is a subsection headed "Poker motion costs" about peek meshes, shadow masks and texture caps, which is neither canon nor words. It sends every session to `ARCHTECTURE.md` (28,503 bytes), where the paragraph on the phone's peek renderer, bend meshes and generated textures is another 511 bytes inside the section on commands and commits. Together that is about 3.4 KB, around 850 tokens, that only a Poker animation task needs, in the two most-read documents in the repo, in sessions that mostly are not.

## Proposal
Move "Poker motion costs" verbatim to `docs/audits/poker-animation/README.md` (the audit directory it describes; `rendering-handoff.md` already lives there) under its own heading, leaving one line in §9 pointing there. Move the peek-renderer paragraph from ARCHTECTURE.md to the same file, leaving a one-sentence ownership summary (`PokerPlayer.tsx`, `poker-bend.ts`, `poker-peek-renderer.ts`) and a link. Fix any link in `docs/` that anchored to the moved text. In: `docs/design.md`, `ARCHTECTURE.md`, `docs/audits/poker-animation/README.md`. Out: rewriting any of the moved prose, trimming anything else.

Judge: sonnet, because it is a cut and paste with the byte counts above as the check.

## What you'll see
§9 is 4 KB of vocabulary again, and the architecture map stops describing shader lighting. A Poker animation task finds the detail where the audit evidence is.

## Verification
`wc -c` on §9 and ARCHTECTURE.md before and after, recorded in the commit message; `grep -rn 'Poker motion costs' docs ARCHTECTURE.md` finds the pointer and the new home only; `npm test` unaffected.

## Risks and the alternative considered
Someone hunting Poker rendering lore may look in the design guide first; the pointer stays. Alternative: trim the prose instead; rejected because it is recent and accurate, just misfiled.

## Needs from Rick
