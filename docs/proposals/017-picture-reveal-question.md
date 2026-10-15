---
id: 017
title: Picture reveal: a photo sharpens over ten seconds and an early buzz pays more
kind: feature
size: M
judge: opus
status: done
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
built_by: f12a0b93-a890-49e5-94dc-3172202866ca
branch: t3code/10db7534
host: k16
merged: 0b8aaae996336bedeeec5d48cfee638d670b2dbf
---

## Opportunity
Packs can attach a picture (`I:` in `shared/pack.ts`, "The board shows it when the question arms", README) and two walkthrough images exist (`packs/images/flag.svg`, `sign.svg`). Today the picture is simply up: the question is still won by reflex on the question text. Quizbowl-lite shows the value of a question that gets easier as it goes (power cutoff after fragment N, `server/modes/quizbowl.ts`); a picture that goes from blur to sharp is the same pyramid for images, and it works for a room that cannot hear or does not want a voice. PRODUCT.md principle 2: "make the board legible and engaging for the room".

## Proposal
`K: reveal` requires an `I:` line. On arm the board renders the image through a canvas at a mosaic of 6 px cells and refines toward full resolution across `round.reveal = { from, until }` (server times; `revealSec` is a new host setting beside `choiceSec`, default 10 s), while the voice reads the question text once. The value on offer decays with the same clock in steps of a quarter: 2× the value in the first quarter, down to 1× at the end, computed in `shared/scoring.ts` from the buzz's clamped time against `reveal`, so the wall and the award agree. A buzz freezes the image where it is; a wrong answer resumes the reveal from that point for the rebound. Phones see the image only with the mirror on, as now. In: pack kind, Round field, Reader timing, scoring step, board renderer (a browser effect inside `Board.tsx`, driven by the public fact), host setting, a style-guide page, three sample questions with CC0 images. Out: audio reveal (see 020), video, pixelation on the phone (it would read ahead of the room).

Judge: opus, because the decay steps, the clock and the freeze rule are pinned and the work is wiring one more public fact through reader, scoring and board.

## What you'll see
A grey-and-sand mosaic; someone shouts "that's a camel"; the stamp reads +400 at the three-second mark. On the rebound it sharpens further and the second buzz earns +300.

## Verification
`npm test`: scoring steps against `reveal` boundaries including a buzz before `from` and after `until`, the freeze-and-resume rule across a rebound, pack parsing refusing `K: reveal` without `I:`. `npm run build`, then `adversarial-qa` on the refinement motion (it is a new moving visual) and a `walk-images` extension.

## Risks and the alternative considered
Mosaic on a phone screenshot sent to a friend is a cheat vector for a trusted room; irrelevant here. Canvas work for a 1920-wide image at 60 fps is fine on an Apple TV browser but the renderer must refine on a fixed step (every 250 ms) rather than per frame. Alternative: reveal by sliding a cover; rejected because a cover reveals a region, not the whole, and the "what is it" guess depends on the whole.

## Needs from Rick
