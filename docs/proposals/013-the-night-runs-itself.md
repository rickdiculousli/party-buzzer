---
id: 013
title: The night runs itself: introductions between blocks and autoplay across minigames
kind: feature
size: L
judge: opus
status: accepted
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
Autoplay carries a block of spoken questions by itself, then stops at every seam. An introduction exists for the first block only (`Arrival` is `{ kind: 'introduction'; blockAt: 0 }` in `shared/protocol.ts`; README: "It appears for the first block only"). A minigame block "leaves the quiz alone; the host opens the match from the Play tab" (`ARCHTECTURE.md`), then Start, then Close, then the next block waits for Arm. In `setlists/full-night.json` that is six host presses for the two minigame blocks alone (open, Start, Close each) in a forty-five minute night, with the host explaining each game by mouth. The roadmap's project 4, "Introductions between blocks: brief instructions connect quiz, host-read, and minigame blocks without breaking autoplay", is the remaining piece of PRODUCT.md principle 3, "one continuous game night across the quiz, setlist blocks, and minigames".

## Proposal
Three linked changes. (1) `Arrival.introduction` takes any `blockAt` and a stable `blockKey`; entering any fresh block under autoplay raises it, with `shared/arrival.ts` composing the line from the block (mode, count, value, duel rule, or the minigame's one-line goal from `client/minigame-info.ts`) and the voice reading it when a voice is on. (2) An introduction under autoplay dismisses itself after `autoplay.introSec` (new field in the triple, default 12 s), or on the host's Continue. (3) Entering a minigame block under autoplay dispatches `prepareMinigame` with the block's options; the match auto-starts when every connected player has readied in the lobby (a `ready` flag on `MinigameLobby`, with a phone button) or after 60 s; results dwell `nextSec` then `closeMinigame`, which already advances the setlist. The Reader stays the only `arm` issuer; the Hub owns the minigame automation timers beside its collection timers. In: arrival type and presentation, autoplay field, hub timers, lobby ready flag, phone ready button, host Continue unchanged. Out: Poker (untimed, host-closed by design), practice rounds inside minigames (roadmap project 3), new copy beyond the composed line.

Judge: opus, because every lifecycle step is pinned above and the hard part is cancellation across undo, jump and a disconnect mid-countdown.

## What you'll see
The host presses Arm once at 8 pm. Trivia plays; "Next: Sketch. Draw the word, everyone guesses. Tap Ready." Phones ready, the match starts, scores land, "Next: Tank battle…", through to the finale, with the host on the sofa holding a phone like everyone else.

## Verification
`npm test`: setlist integration tests on the mock clock (001) for intro raise, auto-dismiss, undo restoring an intro under a fresh id, a jump cancelling pending automation, and a minigame block auto-preparing and auto-closing; `hub.test.ts` for timers cleared on `clearSetlist`. `npm run build`; `walk-setlist` extended with a minigame block. Manual checklist "Arrival" gains three lines.

## Risks and the alternative considered
Automation that fires while the host is doing something by hand is the danger; every automated step goes through `Hub.dispatch` and is refused or no-op under the same ladder as a human press, so a host who opens Poker in the gap is not fought. Players who never tap Ready delay the match to the 60 s fallback. The alternative, a host-only "Next block" key, is one less press per seam and still leaves the explanation to the host.

## Needs from Rick
