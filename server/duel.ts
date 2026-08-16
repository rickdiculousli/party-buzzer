/**
 * Heads-up duels. Framework-level, like items: modes never learn duels exist,
 * and duels never learn which mode is scoring. Selection rules are data — a
 * future rule is a row in DUEL_RULES, not code — and the catalog rides State
 * so the host's rule picker renders itself.
 *
 * Player entry (volunteer / back off / vote) rides the `act` channel through
 * duelAct; seating rides host actions in state.ts. The hub enforces the
 * result with one check on round.candidates at the buzz gate.
 */
import type {
  DuelPoolEntry, DuelRuleInfo, DuelState, PlayerId, State,
} from '../shared/protocol.ts'

export const DUEL_RULES: DuelRuleInfo[] = [
  { id: 'host-pick', name: 'Host picks two', entry: 'none', resolve: 'host' },
  { id: 'random', name: 'Random draw', entry: 'none', resolve: 'random' },
  { id: 'vote', name: 'Room votes — most voted go', entry: 'vote', resolve: 'votes' },
  { id: 'volunteer-random', name: 'Volunteers, random draw', entry: 'volunteer', resolve: 'random' },
  { id: 'volunteer-backoff', name: 'Volunteers, back off to two', entry: 'volunteer', resolve: 'host' },
]

export function duelRule(id: string): DuelRuleInfo | undefined {
  return DUEL_RULES.find((r) => r.id === id)
}

/** The static catalog the host's rule picker is rendered from. */
export function duelCatalog(): DuelRuleInfo[] {
  return DUEL_RULES
}

/** Who may be seated: connected, and in teams mode holding a team. */
export function eligible(state: State): PlayerId[] {
  return state.players
    .filter((p) => p.connected)
    .filter((p) => state.mode !== 'teams' || !!p.teamId)
    .map((p) => p.id)
}

function teamOf(state: State, playerId: PlayerId): string | undefined {
  return state.players.find((p) => p.id === playerId)?.teamId
}

/**
 * Seat two from a ranked list. In teams mode the second seat comes from a
 * different team than the first — a duel inside one team scores for both
 * sides at once, which is no duel.
 */
function twoSeats(state: State, ranked: PlayerId[]): [PlayerId, PlayerId] | null {
  const first = ranked[0]
  if (!first) return null
  if (state.mode !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(state, id) !== teamOf(state, first))
  return second ? [first, second] : null
}

/**
 * The two finalists per the duel's rule, or null when the pool cannot fill
 * the seats (or the rule leaves seating to the host). Null is not an error:
 * the window stays open and the host overrides or cancels.
 */
export function resolveDuel(state: State, duel: DuelState): [PlayerId, PlayerId] | null {
  const rule = duelRule(duel.rule)
  if (!rule || rule.resolve === 'host') return null
  const ok = new Set(eligible(state))
  if (rule.resolve === 'votes') {
    // ponytail: ties break by pool position — who received their FIRST vote
    // first, not who reached the tying count first. The faithful version
    // needs a timestamp beside each voter id; add one if ties feel wrong.
    const ranked = duel.pool
      .filter((e) => e.votes.length > 0 && ok.has(e.playerId))
      .sort((a, b) => b.votes.length - a.votes.length)
      .map((e) => e.playerId)
    return twoSeats(state, ranked)
  }
  // random: entry 'none' draws from everyone eligible; volunteer rules draw
  // from whoever is still in.
  const source =
    rule.entry === 'none'
      ? [...ok]
      : duel.pool.filter((e) => e.in && ok.has(e.playerId)).map((e) => e.playerId)
  for (let i = source.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[source[i], source[j]] = [source[j], source[i]]
  }
  return twoSeats(state, source)
}
