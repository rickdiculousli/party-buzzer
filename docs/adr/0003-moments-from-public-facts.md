# Display moments come only from facts every role receives

`momentOf` reads only fields `viewFor` sends to every role (`phase`, `armedAt`, `spoken`, `award`, `held`, `duel`, `buzzable`, `arrival`, `readingActive`), never `order`, `whole` or the mirrored text, so the board and every phone compute the same moment from differently redacted state. Names cannot be shared that way, so they travel on `Wall`, never on `Moment`.

The module deals in content and identity, never appearance (a hero tone is `penalised`, not a colour; the stylesheet maps it), and it never reads a clock or the DOM. The three time-dependent facts arrive as `Local`, each a clock the client owns: `open` is the countdown to `armedAt` having run out, `settled` is the transcript having finished typing and then held `--verdict-hold`, and `retired` is the penalty dwell (`--penalty-dwell`) having elapsed. Keeping them inputs is what keeps the file pure and runnable under `node:test`.

Only the board waits on `settled` and `retired`; the host desk and phones pass both as true. The desk types its transcript too but gates nothing on it: `settled: false` would put it in `answer:judging` and take the judging buttons away when they are wanted, which is why `answer:judging` never reaches `notesFor`. The phone renders no transcript or award stamp.

Where: `shared/wall.ts` (`momentOf`, `Local`, `Moment`, `Wall`), `client/Host.tsx` (`QuizDesk`, `notesFor`), `client/Player.tsx` (`Player`)
