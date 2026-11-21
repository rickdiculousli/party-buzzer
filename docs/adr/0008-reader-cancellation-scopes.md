# The reader's waits are scoped by abort signals, not flags

Every await in the read loop takes an `AbortSignal` and throws when it fires, so a stopped, replaced or undone question can never wake up and write into a live round; the protection lives at the `await`, not in a flag each caller must remember. A read session is a fresh `AbortController` (`stop()` aborts it, `begin()` replaces it), and each question's scope is `AbortSignal.any` of the session and a watch on the `questionId` its arm minted. Once the verdict is in, the waits switch to the session's scope, because `next` clears the `questionId` and a question-scoped payoff wait would abort on the very keypress that releases it.

Where: `server/reader.ts` (`Reader.run`, `begin`, `stop`, `watch`, `until`, `waitOutBuzz`)
