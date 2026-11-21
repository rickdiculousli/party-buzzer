# Item rules and how effects find their question

- Freeze is usable only between questions (`IDLE`) and lands on the next arm. During `ARMED` thumbs are already down, so a freeze then would be a race, not a boon.
- Shield is never fired by hand (`usableWhen` is always false); it is passive and consumed inside freeze's `apply` when found in the target's inventory.
- Steal checks the lockout list itself. `buzzBlockReason` only consults lockouts through a mode's `canBuzz`, which trivia does not define.
- Steal records an effect stamped with the attempt instead of editing `round.order`, because the Hub republishes the order from raw buzzes on every packet and would clobber a direct edit; `Hub.publish` prepends the thief.
- On `arm`, effects stamped with the previous attempt are dropped and every unstamped effect is stamped with the new `attemptId`, so an effect fired between questions (a freeze) applies to the next question armed. `openRebound` restamps live effects to the rebound's attempt for the same reason.

Where: `server/items.ts` (`ITEMS`), `server/hub.ts` (`publish`), `server/state.ts` (`mutateHostAction` `arm` case, `openRebound`)
