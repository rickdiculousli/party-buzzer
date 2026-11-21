# Host desk notes are a lookup against the moment

`notesFor` maps every `Moment` to the judge-row and arm-row notes, with no `default`, so a new moment does not compile until it says what the desk shows. It never ranks moments (`momentOf` already did) and stays silent where the screen already shows the state; a judge note is null where the judging buttons are dead. Arm is never refused by a note: arming a round still on the board is legal, and on a seated pair it is the rematch.

The notes come from the moment, not from `refuses`. `judgeable` is narrower than the table, which may not read `settled` or `retired`, so a sentence driven off the table would come back empty in the gap between them. Only sentences that really are refusal codes use `REFUSAL_TEXT`; the rest are facts about the moment.

Where: `client/Host.tsx` (`notesFor`, `QuizDesk`)
