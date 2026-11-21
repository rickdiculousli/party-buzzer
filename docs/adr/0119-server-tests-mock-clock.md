# Time-driven server tests run on Node's mock timers, stepped in small increments

Reader and night tests enable `mock.timers` for `setTimeout`, `setInterval` and `Date` together, so a busy machine cannot move a fold or a timer past an assertion. Helpers (`settle`, `wait`) advance the clock in 5 ms steps and yield to the event loop between steps, so work that waits on a timer and then on a promise or file read keeps pace. The test wrapper resets the mock timers before enabling them, because a test that timed out never reached its `finally`.

Where: `server/reader.test.ts` (`test`, `wait`), `server/reader.joined.test.ts` (`test`, `settle`), `server/night.test.ts` (`test`)
