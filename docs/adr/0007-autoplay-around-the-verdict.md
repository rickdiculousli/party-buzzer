# Autoplay presses the keys around the verdict, never the verdict

The host or the spoken judge still judges every buzz; autoplay only advances after the payoff dwell, opens a held rebound after its beat, and passes a question nobody touched. With autoplay on and the reader driving, `wrong` sets `round.held` and empties `round.order` instead of reopening, so the miss sits on the wall with buzzers shut until the reader sends `rebound` and the room and phones learn the question is live together; opening first would leave buzzers live under a result and make buzzing on the verdict the winning strategy. A host judging by hand keeps the instant rebound. Only silence passes itself: dead air gets the buzz-beat dwell, the answer and then `timeUp`, while anyone mid-answer is waited out however long the host takes.

Where: `server/state.ts` (`mutateHostAction` `wrong` and `rebound`, `openRebound`), `server/reader.ts` (`Reader.run`, `waitOutBuzz`, `dwellMs`)
