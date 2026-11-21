# Poker surfaces derive the same motion from the same facts, and a reload replays nothing

- `dealTimes` gives each seat's card times from the hand number, clockwise from the seat left of the button, and both the board and every phone read it, so a phone's cards arrive as the board's dealer reaches that seat.
- `showsRight` decides which way a pair turns over at showdown as the board turns it, and the phone turns its pair the same way.
- `pokerCues` splits cues by surface: room cues play on the board, a player's own cues on their phone. Cards and chips that move sound as they move, so only motionless changes are cued there.
- Every Poker surface treats the first frame it sees (or one from another match) as the baseline: feed entries and reactions older than it are not animated or cued, a hand already dealt is not dealt again (a reload during the deal still watches it), board cards already out are face up and still, the winner cue plays only on a live switch to results, and only hole cards the board saw face down get the showdown turnover. A phone that arrives with its cards already shown just shows them.

Where: `client/poker.ts` (`dealTimes`, `showsRight`, `pokerCues`), `client/PokerBoard.tsx` (`useFresh`, `PokerBoard`), `client/PokerPlayer.tsx` (`PokerPlayer`)
