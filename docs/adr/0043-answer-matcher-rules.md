# Spoken answer matching rules

A variant matches when every content token has a heard token within reach; anything else the player said is ignored.

- Tokens of five characters or fewer forgive one edit, longer ones two, since a long word has more for speech-to-text to mangle.
- A variant made only of articles ("The") has no content tokens and never matches, rather than matching everything.
- A wanted token also matches two adjacent heard tokens joined, because speech-to-text may split one word ("Paris" heard as "pair us").

Where: `server/match.ts` (`within`, `matchAnswer`)
