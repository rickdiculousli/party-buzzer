# Picture reveal

A picture goes from a coarse mosaic to sharp on the board over **Reveal time**
(10 s by default) while the voice reads the question once. Players buzz as
usual, and an early buzz pays more: double the round value in the first
quarter of the reveal, then 1.75×, 1.5× and 1.25×, and the plain value once
the picture is sharp. A buzz holds the picture; after a wrong answer it keeps
sharpening from where it stopped for the rebound. A wrong answer costs the
plain value, as on any buzz question. Reference: the `K: reveal` questions in
[packs/game-night.txt](../../packs/game-night.txt).

```
V: 200
K: reveal
I: images/camel.svg
What is this?
A: a camel | dromedary
```

- `K: reveal` needs an `I:` line, a path inside `packs/`. It takes no `C:` or
  `U:` line.
- Choose a picture whose whole shape is the clue: an animal, a building, a
  vehicle, a landmark. The mosaic starts six cells across, so colour and
  silhouette carry the early guesses; a picture that is only recognisable
  from a small detail (a logo, text, a face) is never guessed until it is sharp.
- Fill the frame with the subject. The six-cell start is mostly background, so
  a background that names the answer (desert for a camel, sea for a
  lighthouse) gives it away at double value; a small subject in a busy scene
  stays a blur for most of the reveal.
- Never put the answer in the picture as text, and keep the question text
  generic ("What is this?"): the board shows it whole from the start, and
  "What animal is this?" is half the answer.
- SVG, PNG and JPEG all work. Keep the long side at 1,000 to 2,000 pixels and
  the file small (a few hundred KB): the board fetches it as the question arms
  and the clock is already running, so a heavy file eats the double-value quarter.
- Use only pictures you may share: your own, or CC0 / public-domain images,
  and list them in [packs/images/CREDITS.md](../../packs/images/CREDITS.md).
- The `A:` line follows the shared rules below in [README.md](README.md).
