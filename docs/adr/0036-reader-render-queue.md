# Speech renders behind the game through one deduplicated queue

Rendering a pack is minutes of synthesis, so `ensure` loads the pack, queues every text, and resolves as soon as the first question's audio is ready; the rest renders behind the game and `waitFor` gates each question on its own audio.

- Texts are deduplicated across every pack (clips are keyed by spoken text), because `speech.render` has no lock of its own and two workers on one cache path would race.
- Rendered packs stay in memory for the session, so a setlist crossing between packs at a block boundary does not stall.
- A text that fails to render still resolves its waiters, and the question goes up on the board unspoken.
- `textsOf` is the single list of texts a read speaks (questions, cues, quip pools). `priceUp` prices the uncached ones for the host's pack picker, and `npm run voice` builds a real `Reader`, asks it for `textsOf`, and looks takes up in the same cache with the same keys, so the price is what gets sent and a take rendered offline is already paid for in the game. Nothing renders there without `--go`. The tool's reader gets a stub aligner because only its presence matters: with an aligner a question is spoken as one utterance, which is what the game renders.

Where: `server/reader.ts` (`ensure`, `pump`, `drain`, `waitFor`, `priceUp`, `textsOf`), `tools/voice.ts`
