# Poker board table motion rules

- A pair or stack moving as one sounds once, from its first piece; cards whoosh in the air and land silently. A whoosh's rate is fitted to its flight time (`fitFlight`, clamped), so a quicker throw whooshes shorter and higher.
- Hole cards sit further in above and below a seat than beside it (`HOLE_IN`) to clear the seat's name and notes; the pot sits beside the board cards so the lanes above and below stay clear for seats.
- A street that arrives while the last is still moving waits for it.
- Bets build on their pile (a raise adds the difference on top); a bet swept to zero, or left from a street the board missed the end of, goes to the pot.
- Chips in flight are hidden from the stack they land on (`held`/`pending` on `ChipStack`) until they arrive.
- The pot is pushed to winners as the stacks it stands in, each stack to whoever is still owed most, and it lies there until the next hand.
- In flight a card stacks over every card already down, later pitches over earlier ones; landed, it lies with the rest.
- `useSize` uses a callback ref so a table that mounts after a waiting screen is still measured.
- The shot ring restarts its animation only when clock sync moves the deadline past a small drift tolerance, not on every tick.

Where: `client/PokerBoard.tsx` (`PokerBoard`, `pushPot`), `client/PokerParts.tsx` (`Piece`, `ChipStack`, `fitFlight`, `useSize`, `ShotRing`)
