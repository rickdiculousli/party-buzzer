# The wall's middle band has exactly one occupant, chosen by moment

The middle band shows exactly one of hero, clue, nominations, face-off, call, finale or next (a scoreless mode drops `call` and `next` and leaves the stage blank rather than saying "Buzz" or a value). `Middle` is a union of one-key objects so the compiler enforces that, and `middleOf` is an exhaustive `switch` on the moment with no `default`, so a new `Moment` will not compile without a row. Each row says what its moment prefers and what it settles for when that has no data, never what outranks what: `momentOf` is the one ladder, and a second ranking out of raw state lets a face-off outlive its buzz-in. The fallback is `call: 'ready'`, a stage waiting for the host.

Row choices an editor could easily get wrong:

- `answer:judging` keeps the spoken name, then the leader: the verdict clears `order` the moment it lands, and without this the stage flicks back to the clue under an answer the room has not been told the result of.
- A miss (`verdict:hold`, `verdict:penalty`) and a payoff (`verdict:award`) take the middle from the clue; a correct answer spends the question, so the winner's name holds the payoff's dwell.
- `answer:locked` and `buzz:collecting` prefer the leader, then clue, then the duel pair, then "Buzz": the pair holds the stage through the hub's provisional-leader delay (`REVEAL_MS`), so a duel's buzz-in replaces it rather than blanking it first.
- The duel pair comes from `duel.seated`, not `buzzable`: a rebound narrows `buzzable` to one, but who is on the stage does not change.
- `buzz:arming` (the ~300 ms before the buzzers open, too short to read) holds what came before: the miss on a rebound, the card on a fresh arm.
- `idle:ready` shows the next question's card and value; only words already said keep the clue, since an active reader alone would put an empty clue up and hide the card.
- `wallOf` may read the full `order` (it is the board's), because names are exactly what a moment cannot carry. An arrival empties every lane, so no transcript, award or choices left in an idle round show through.
- The award stamp shows only in the verdict moments: a payoff stays until the next arm, a penalty is a beat, and a held rebound keeps it up until the buzzers reopen.
- The value chip shows from the arm through the verdict; between questions the card says the number large, so the chip is hidden there.

Where: `shared/wall.ts` (`Middle`, `middleOf`, `wallOf`, `Wall`)
