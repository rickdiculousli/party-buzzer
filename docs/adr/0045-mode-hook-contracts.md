# Mode hook contracts

- `onWrong` receives the `neg` the host sent; 0 always means no penalty.
- `onArm` is the fresh-question reset and runs only on `arm`, never on a `wrong` rebound.
- `onFragmentEnd` receives the cumulative completed-fragment count from either playback path (joined or per-fragment) and returns whether it changed state.
- Without `viewModuleState`, players see none of the mode's memory and host and board see it raw.

Where: `shared/modes/types.ts` (`GameModule`)
