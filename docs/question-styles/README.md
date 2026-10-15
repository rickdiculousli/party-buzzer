# Question styles

Writing rules for question packs, one file per style. The pack file format is
documented in `shared/pack.ts`.

| Style | Guide |
| --- | --- |
| Quizbowl-lite | [quizbowl-lite.md](quizbowl-lite.md) |
| Multiple choice | [choice.md](choice.md) |
| Closest guess | [closest.md](closest.md) |
| Picture reveal | [reveal.md](reveal.md) |
| Voice performance (`S:`, `R:`, quip pools) | [voice.md](voice.md) |

## Accepted answers (`A:` line), all styles

Multiple-choice and closest questions have no spoken answer to match, so these
rules do not apply to them: a choice question's `A:` names the right choice,
and a closest question's is the number.

The first entry is what the board shows. `server/match.ts` counts a guess as
correct when every word of any accepted answer appears in what the player said.
It ignores extra words and drops "the", "a" and "an".

- Keep accepted answers short: one or two words. Long phrasings ("plants
  making food from sunlight") almost never match word for word.
- Add the common colloquial names people actually say: "Lincoln",
  "Honest Abe", "Fab Four", "pyramids".
- Leave out alternates that a shorter one already covers. "Lincoln" covers
  "Abe Lincoln", and "Titanic" covers "RMS Titanic".
- Don't add a variant made only of articles, or a very short word that is
  within one letter of common words, because it would match unrelated guesses.
