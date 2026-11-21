# The board's hero: keyed on the name, toned in CSS

`fx-hero-slam-glow` is a mount animation, so an arrival is the DOM node's lifetime. `Hero` keys its outer element on the name itself rather than relying on each caller to pass a `key`: a different name is a new element and slams in (a rebound taking the stage from the miss it answers is an arrival), while the same name being judged keeps its letters in place and only recolours.

`wallOf` names the hero's tone (answering, awarded, penalised) and never an appearance; `.board__hero.is-awarded` and `.is-penalised` map them to brass and tally and set `--fx-color`, which the glow burns in. Brass is only ever a result. The board's hero splits the signature in two: the slam stays on the name (`.board__hero--toned`), and the glow rides an inner `.board__hero-tone` keyed on the tone, so a verdict remounts it and the brass or tally arrives already lit instead of the old glow cooling in the wrong colour. A plain `.board__hero` elsewhere keeps both animations on one element.

Where: `client/Board.tsx` (`Hero`), `shared/wall.ts` (`wallOf`), `client/style.css` (`.board__hero`, `.board__hero--toned`, `.board__hero-tone`)
