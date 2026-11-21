# The alignment helper is one line-protocol session per clip

Alignment asks one clip hundreds of range questions and most of a one-shot run is process startup, so `stt --session <file>` reads `"<fromMs> <toMs>"` lines and answers one transcript line each; `transcribePool` runs about four sessions per clip, past which speechd serialises anyway. Two macOS constraints shape the Swift side: every reply is written unbuffered (`emit`), because `print` block-buffers on a pipe and a buffered answer deadlocks both processes at zero CPU; and it turns the main runloop (`pump`) rather than waiting on a semaphore, because XPC to speechd lives on the main runloop and parking it means recognition never calls back. A dead helper resolves every queued request empty, which becomes a fold at the clip's end rather than a hung render.

Where: `server/stt.ts` (`transcribeSession`, `transcribePool`), `server/stt/stt.swift` (`pump`, `emit`), `server/stt.test.ts`
