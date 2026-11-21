# The alignment session keeps one helper open per clip

Alignment asks one clip hundreds of range questions, and most of a one-shot run is process startup, so `stt --session <file>` reads `"<fromMs> <toMs>"` lines on stdin and answers one transcript line each.

- A session is serial: the bisection cannot ask its next question until the last is answered. `transcribePool` runs a few sessions per clip (width 4); past about four the speech daemon serialises anyway, so whole questions also run at that modest width.
- Every reply is written unbuffered (`emit`): `print` is block-buffered on a pipe, and a buffered answer deadlocks both processes at zero CPU.
- The Swift side turns the main runloop (`pump`) and never blocks on a semaphore, because XPC to speechd is set up on the main runloop and parking it means the recognition task never calls back.
- An empty transcript is a real answer ("no complete word yet"); a no-speech error from the recogniser is reported as empty, not a failure.
- If the helper dies, every queued request resolves empty, which the aligner turns into a fold at the clip's end, rather than hanging the pack render.
- Authorization is requested lazily, so zero-length ranges answer without the speech service; `server/stt.test.ts` relies on that and on awaiting each request before the next to test the line protocol and flushing deterministically.

Where: `server/stt.ts` (`transcribeSession`, `transcribePool`), `server/stt/stt.swift` (`pump`, `speechRecognizer`, `transcribe`, `emit`), `server/stt.test.ts`
