# Poker follows tournament Hold'em rules, with a few deliberate table choices

- Chip accounting: `Seat.bet` is chips put in on this street, `Seat.contributed` is chips from earlier streets of the hand; `gather` moves one into the other at each street.
- Pots slice at each all-in level, main pot first, and folded chips count toward the amount. A layer only one player reached is that player's uncalled bet: it goes back quietly, never as a feed "win". Folded chips above every live level are dead money for the last pot when two folders reached them, and returned when only one did.
- Odd chips in a split go to the first winner left of the button.
- A short all-in (less than a full raise) makes whoever owes act again but does not reopen raising: `mayRaise` stays false until someone makes a full raise.
- Players who bust in the same hand are placed by their stacks as it began (`startStack`), larger first; equal stacks share the place.
- The deck for each hand follows from `deckSeed` and the hand number. `deckSeed` is drawn with `crypto.randomInt` at create, separate from the match seed that clients can see, so the visible seed cannot reveal cards; tests pass a fixed one to replay a deal.
- The first hand moves the button one seat on, so `createTable` seeds the button one seat back. A checkpoint stores the button before its hand moved it, so a resume's `startHand` moves it to the same seat.
- Equity is enumerated exactly from the flop on; preflop has too many boards, so it is sampled (`EVALUATIONS` evaluations in all). `PokerOptions.evaluations` shrinks that sample for tests only and is deliberately not a host option.
- In a runout the river gets its own beat before the showdown, and the odds stay as the turn left them, since a full board's odds would name the winner while the river is still landing.
- A player who drops on their turn gets the short away clock from now; coming back restores their own clock measured from the turn's start.
- A wheel (A-2-3-4-5) is a five-high straight.

Where: `server/minigames/poker/table.ts` (`createTable`, `raiseTo`, `showdown`, `endByFold`, `finishHand`, `setPresence`, `stepTable`), `server/minigames/poker/pots.ts` (`buildPots`, `awardPots`), `server/minigames/poker/equity.ts` (`equity`), `server/minigames/poker/evaluate.ts` (`straightTop`), `server/minigames/poker/types.ts` (`Seat`, `PokerCheckpoint`, `PokerOptions`), `server/minigames/poker/definition.ts` (`create`)
