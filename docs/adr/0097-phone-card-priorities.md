# The phone card answers "may I press", with its own priorities

`phoneOf` orders its cards differently from the wall's moments, on purpose. Only the player actually answering gets a screen of their own; everyone else gets some flavour of "not you", because a phone's job then is to be quiet. The exception is a verdict, which the whole room is being told at once. The phone never shows anything the room has not been told: the only other name it shows is the award's, which the wall shows too.

- The arrival and finale cards sit above every personal state; a finale phone says nothing before the ceremony calls its place.
- A payoff (someone else's) outranks every "not you" card until the next arm clears the award, as on the wall; the phone has no stamp dwell, so it also holds through `idle:ready`. The answerer keeps "Right +N" the same way. `Mine.told` is the award only once the room has been told it: the phone holds it back while the board types the transcript.
- A dead duel (`buzzable` is `[]`) sits above the answer states, unlike the wall, where a miss still being read outranks it: to "may I press", "nobody may, ever" beats "reopening in a moment", a promise nothing will keep. So `Mine.dead` is read from `buzzable`, not from the moment.
- Someone else's miss shows only for a held rebound; one that reopens at once has 300 ms of delay ending in the buzzers-open cue, so the opening is the news.
- "Shut" means the buzzers are closed with an answer under way; a transcript typing over an open rebound is not that, and the phone may press.
- The mic mounts in one branch only: this phone is the locked-in leader and the judge's window is open; `talk` rides `judging` so exactly one place decides it.
- "In" shows while `pressed` and `armed`: `pressed` is keyed on the arm and stays true however the question ends, and a scored question ends IDLE, which is neither armed nor locked.
- `react` is a flag beside the mood, not a mood, so the reaction row composes with any card; it uses the same facts `reactBlockReason` checks on the server.
- On a closest reveal only first place is brass (`first`); a half-paying second is `placed`, like the board's silver.

Where: `shared/wall.ts` (`phoneOf`, `card`, `Mine`, `Phone`), `client/Player.tsx` (`Mine` construction)
