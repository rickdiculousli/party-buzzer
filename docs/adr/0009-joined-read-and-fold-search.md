# The reader speaks a whole question in one breath and reveals it at measured folds

A fragment synthesised on its own gets sentence-final intonation even mid-sentence, so with an aligner the reader renders the whole question (or its `S:` script) as one clip and reveals it clause by clause at fold times found in the audio; without one it plays a clip per fragment. Finding a fold is verification, not recognition: cut the clip at t, transcribe, count the source words that came back whole; that count is monotonic, so bisection finds every boundary, and `align.ts` stays pure with transcription injected. Uncertainty always resolves late (a fold fires as the voice begins the clause it reveals, a mishearing undercounts, and a failed alignment lands the text when the clip ends), because a board that lags is acceptable and one that runs ahead is not.

Where: `server/align.ts` (`join`, `candidates`, `locate`, `completed`), `server/reader.ts` (`ReaderOpts.align`, `REVEAL_LAG_MS`, `speakWhole`)
