# Closest guess

Every player types a number on their phone; the nearest takes the round value.
Reference: the `K: closest` questions in
[packs/game-night.txt](../../packs/game-night.txt).

```
V: 200
K: closest
U: steps
How many steps are in the Eiffel Tower to the top?
A: 1,665
```

- Ask for one number with one right answer that the pack can state: a count,
  a year, a height, a distance. Avoid anything that changes month to month
  (populations, records still being broken) unless the question pins a date.
- Write the question so everyone can make a sensible guess and almost nobody
  knows it exactly. "How tall is Everest?" is good; "How many moons has
  Earth?" is not.
- Name the unit in the question or on a `U:` line, never in `A:`. The phone's
  pad shows the `U:` word beside the number and the board shows it under the
  answer, so keep it to one short word: `metres`, `steps`, `km`, `years`.
- `A:` is the number alone, zero or more. Commas are fine (`1,665`); a decimal
  point is fine when a decimal answer is natural (`2.5`). The phones' pad has
  no minus key.
- Years are numbers too ("In what year did..."), and work well: the room
  usually spreads over a century.
- Scoring is fixed: the nearest takes the value, doubled for an exact hit;
  ties share it; with six or more guessers the next-nearest takes half. There
  are no ranges or tolerances in the pack.
