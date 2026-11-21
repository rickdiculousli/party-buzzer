# Autoplay presses the keys around the verdict, never the verdict

The host (or the spoken judge) still judges every buzz. Autoplay only presses the keys either side of that judgment: it advances after the payoff dwell, opens a held rebound after its beat, and passes a question nobody touched.

- When autoplay is on and the reader is driving (`state.autoplay.on && state.readingActive`), `wrong` sets `round.held` instead of opening the rebound, and empties `round.order` so the judge, whose window needs a leader, stays quiet. The miss sits on the wall with buzzers shut, the miss quip plays, then the reader sends `rebound`, so room and phones learn the question is live at the same moment. Opening first would leave buzzers live while the wall shows a result, making buzzing on the verdict the dominant strategy. This also applies to a miss after the voice has finished.
- A host judging by hand keeps the instant rebound: they pressed Wrong when ready and there is no reader to arm it. The `readingActive` half matters: autoplay left on with nobody reading would otherwise hold a round that nothing opens.
- Only silence passes itself: dead air (armed, nobody in the order) gets the buzz-beat dwell and then `timeUp`; anyone mid-answer is waited out however long the host takes. Without this an autoplay loop would wait forever on a room that has stopped playing.
- The answer is published (`revealAnswer`) before `timeUp`, so the wall never shows the unanswered moment without it.
- A verdict quip runs over the payoff dwell, but the next question never starts on top of its tail.
- `dwellMs` reads the autoplay setting fresh at each wait, so toggling autoplay mid-question takes effect on the next beat.
- Only a loop that ends because nothing is left turns autoplay off (handing a host a game that advances itself would fight them); a stop, abort or refused arm leaves autoplay as it was.

Where: `server/state.ts` (`mutateHostAction` `wrong` case, `openRebound`), `server/reader.ts` (`Reader.run`, `waitOutBuzz`, `dwellMs`)
