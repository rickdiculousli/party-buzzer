# Poker phone hand handling and bet sizing

- The collected pair rests with the second card turned across the first (`REST`) so every corner index but one shows.
- A deal pitches each card straight into its place in the pair, timed to when the board's dealer reaches this seat, so the pair is peekable the moment the second card lands; no peek, drag or flick while cards are still animating in.
- The flick throw is two held WAAPI keyframes, so no re-render pulls the cards back; the thrown pair stays mounted until its flight ends. A flick while disconnected or out of turn is refused locally with a shake restarted in place (remounting would replay the deal), because a fold sent then would be lost and only a refusal rolls a throw back.
- A drag above the line writes transforms straight to the element so it costs no render. Pointer capture keeps a flick's trace past the felt; a browser may refuse it and the trace still works inside.
- The peek line is placed from the pair's layout when it appears and on resize, never per frame. Peek frames clamp progress at zero because a frame's timestamp can precede the peek's start.
- The fold reason is latched on arrival because the feed is trimmed mid-hand. Only an auto-check gets a note (an auto-fold has its folded sub-line), and the note clears on its own timer so the next feed entry cannot cancel it.
- Street cards new to this phone wait for the board to turn them, so a folded phone never shows a card before the room sees it. The phone's pot shows what the streets swept in, as the board prints it.
- Unopened preflop (only the blinds in) a raise is sized in big blinds and the pot bar shows greyed, since the pot means little there. Otherwise a raise is the amount over the bet to match, against the pot once the call is in; facing a bet, the call meter sizes it the same way, against the pot before it.
- Bet meters print their label twice, the second inverted and clipped to the fill, so they read on either side of the fill's edge.

Where: `client/PokerPlayer.tsx` (`PokerPlayer`, `DealtCard`, `StreetCard`, `throwPair`, `Meters`)
