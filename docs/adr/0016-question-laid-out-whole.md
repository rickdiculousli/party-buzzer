# The board gets the whole question at the arm and hides what is unsaid

The board receives the entire question at the arm (`round.whole`) and lays all of it out, the part the voice has not reached as hidden text that still takes its space, so every line break and word position holds for the whole question instead of the paragraph rewrapping on each clause. That puts unspoken text in State, so `viewFor` never sends `whole` to a phone, mirror or not. The unsaid part is `visibility: hidden`, not `opacity: 0` or a transparent colour, which would still expose it to screen readers and Select All before the room is asked. Without `whole` (a host reading by hand) the board prints only what has been said.

Where: `shared/protocol.ts` (`Round`), `server/reader.ts` (`speakWhole`), `server/hub.ts` (`viewFor`), `client/Board.tsx` (`Question`, `Said`), `client/style.css` (`.board__unsaid`)
