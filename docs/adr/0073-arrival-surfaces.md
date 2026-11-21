# Arrival surfaces claim only what the server saw

While the room arrives, each surface renders the `arrivalPresentation` it is handed and keeps practice feedback honest.

- The board takes names and colours from the current roster, never from practice receipts, so a receipt for someone who left cannot put them back on the wall.
- A phone shows "Buzzer tested" only from this player's own receipt, so it never claims more than the server saw; local press feedback is the parent's.
- The host's arrival block is informational: it shows the tested count and opens, closes or continues the lobby, but nothing in it gates play on readiness.

Where: `client/ArrivalBoard.tsx` (`ArrivalBoard`), `client/ArrivalPhone.tsx` (`ArrivalPhone`), `client/ArrivalHost.tsx` (`ArrivalHost`)
