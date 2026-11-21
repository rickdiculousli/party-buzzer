# Phone control details

- The practice buzzer fires on `pointerdown`, like the real buzzer, for the same snap; its `onClick` acts only on keyboard activation (`detail === 0`), so a tap never fires twice.
- On the guess pad, Lock in sits beside the typed number rather than under the keys, because a short phone has no row to spare. The value's type shrinks with its length (`--len`), so a long number still shows its last digits and its unit.
- A seated duel player sees a "Heads-up" panel before the arm, because the buzzer says "Wait" to everyone then and that one word means two different things; the panel says which.
- The nomination card prints that tapping your pick again takes the vote back: the gesture is its own undo, which nobody guesses, and a vote you cannot take back is one people hesitate to cast.

Where: `client/ArrivalPhone.tsx` (`ArrivalPhone`), `client/GuessPad.tsx` (`GuessPad`), `client/PlayerDuel.tsx` (`PlayerDuel`)
