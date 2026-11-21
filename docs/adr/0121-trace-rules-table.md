# Trace invariants are a table of plain predicates

- A rule is a name plus a predicate over the whole frame list. Factories (`whenever`, `neverFollows`, `phaseGraph`, `minGap`, `noOverlap`) build the common shapes; a rule they cannot express is written directly in the core shape. There is no rule language or parser.
- `RULES` is the spec: a bug investigated in `trace.jsonl` becomes a row there. Its phase edges are enumerated from `applyHostAction` in `server/state.ts` plus the Hub's own buzz and settle transitions.
- "Voice ends at the buzz" holds because a buzz stops the clip on the server within the same dispatch. The test freezes `Date.now` across that dispatch, since tracing and stopping run synchronously and a millisecond tick between them is not a real audio overlap.

Where: `tools/rules.ts` (`Rule`, `RULES`), `tools/rules.test.ts`
