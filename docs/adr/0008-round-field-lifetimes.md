# What each per-question `Round` field means and when it goes

Several `Round` fields carry meaning in their presence or have lifetimes a reader would not guess:

- `judge`: present means push-to-talk is live for the locked leader; `until` is the deadline, absent means the host ends a stall by hand. Any verdict ends it and the next arm sweeps it.
- `spoken`: the room heard it, so a miss's transcript stays up through an instant rebound as the only line saying why the question is still open. It goes when a held rebound opens (the clue resumes in that instant), when the first press of the next window lands (it would sit above the new answerer), and on the next arm.
- `held`: a miss is on the wall and its rebound waits for the reader (autoplay on and the reader driving). The phase stays `LOCKED` and `order` is emptied, so nobody may buzz and the judge has no leader to re-offer its window to.
- `whole`: the whole question goes to the board at the arm so it can lay the text out once, with the unspoken remainder rendered invisible rather than absent; that is what stops every line reflowing as each clause lands. It never reaches a phone, mirror or not, because the mirror is what the room has already heard.
- `closesAt`: one server-time end for the room's window, used for picking on a choice question and, under autoplay, for the buzz window after a spoken question is read.
- `correct` (choice) and `truth` (closest): presence is what "revealed" means; nothing else marks it.

Where: `shared/protocol.ts` (`Round`), `server/state.ts` (`wrong`, `rebound`, `dropQuestion`, `clearQuestion`), `server/hub.ts` (`buzz`, `viewFor`), `server/reader.ts`
