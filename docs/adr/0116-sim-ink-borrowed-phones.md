# The Ink sim plays for borrowed phones but leaves their guesses to the person

A phone already in the room under a bot's name is borrowed: the sim connects as that player, plays for it, and the phone shows the bot's view. Borrowed players are never kicked on exit. The one thing a borrowed phone keeps is its team's guess: while a borrowed phone is a guesser on that team, no bot types on the guess row. Each letter restarts a wait; a row that sits still for `GUESS_WAIT_TICKS` goes back to the bots, so a shadow who stops typing or closes the tab never stalls the game.

Bots count the letters they have sent per guess row (`typedOn`) instead of trusting the pad in their frame, because an Ink frame carries the pad only when it changed, so a bot reading a stale pad would retype a letter.

Where: `tools/sim-ink.ts` (`bots`, `humanGuess`, `waitingOnPerson`, `typedOn`)
