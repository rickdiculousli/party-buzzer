# Duels are a framework module with data-driven rules

Duels work beside any mode: modes never learn a duel exists and duels never learn which mode scores. A selection rule is a row in `DUEL_RULES` (entry kind plus resolve kind) declared as data (`DuelRuleInfo`), not code, and the catalog rides `State` so the host's rule picker renders from it. Duel, setlist and items state all ride `State`, so snapshot, undo and broadcast cover them without extra plumbing. Players enter through the `act` channel (`duelAct`), seating goes through host actions, and the Hub enforces the seated pair with one check on `round.buzzable` at the buzz gate.

- In a teams grouping the two seats come from different teams: a duel inside one team scores for both sides at once.
- A player votes only for someone on their own team, because the seat is one from each team chosen by the people who live with it. The server enforces it, so a hand-built message cannot get round it, and the phone's roster agrees: it lists only `eligibleForDuel` players on the phone's own team, so nobody spends a vote on someone the seat will pass over, and a player with no team is told why their card is empty.
- A pool entry holds voter ids, not a count, so one vote per player follows from the shape. Voting again for the player you already backed withdraws the vote (as `duelBackOff` is to volunteering). The emptied entry stays in the pool at zero, because a name vanishing from the board the moment its last vote left would look like a bug; `resolveDuel` ignores zero-vote entries.
- `duelAct` does not filter entrants through `eligible()`. A disconnect between entry and close is fine, because `resolveDuel` and `seatDuel` re-filter before anyone is seated.
- `resolveDuel` returning null is not an error: the nomination window stays open and the host seats a pair or cancels.
- `duelOnArm` (fresh `missed`) runs only from the `arm` host action. A `wrong` rebound re-arms without it, which keeps `missed` across the rebound and makes the rebound exclusive to the other seated player.
- The duel pool is public room theatre: phones receive it unredacted.

Where: `server/duel.ts` (`DUEL_RULES`, `twoSeats`, `eligible`, `resolveDuel`, `duelAct`, `seatDuel`, `duelOnArm`), `server/hub.ts` (`buzz`), `shared/protocol.ts` (`DuelState`, `DuelPoolEntry`, `DuelRuleInfo`), `client/PlayerDuel.tsx` (`PlayerDuel`)
