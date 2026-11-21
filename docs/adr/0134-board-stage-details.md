# Board stage layout details

- The timeline's scale sits above the rail and the marks below it: the last mark always lands at full scale (`COLLECT_MS`), so a scale printed underneath would collide with it and repeat its number.
- First place's delta is blank, not "+0": it is the datum the others are measured from, and the axis already says 0.
- Lockout chips are status, not stage content: they sit at the foot of the stage so a rebound's chips never move the timeline above them.
- The band above the middle has three lanes (what was said, the award stamp, the answer), each held open by an invisible stand-in (`Held`) while another is up, so one arriving never pushes another along.
- Standings keep the medal column's width below third place, so every name lines up.
- In the arrival roster the name's flash is keyed on the practice receipt's `seq`, so a repeat press remounts it and replays the flash.
- The join address is printed with its scheme, because the server is https-only and a bare host typed into a phone goes to http first and gets nothing. Scheme, host and port are separate spans so a long certificate hostname wraps between them, never inside one.
- Tug results put the winners' and the rest's lists side by side, so a full room's two halves fit under the verdict.

Where: `client/Board.tsx` (`Timeline`, `Standings`, `Board`), `client/ArrivalBoard.tsx` (`ArrivalBoard`), `client/JoinCode.tsx` (`JoinCode`), `client/TugBoard.tsx`
