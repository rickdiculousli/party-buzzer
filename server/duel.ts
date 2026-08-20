/**
 * Heads-up duels. Framework-level, like items: modes never learn duels exist,
 * and duels never learn which mode is scoring. Selection rules are data — a
 * future rule is a row in DUEL_RULES, not code — and the catalog rides State
 * so the host's rule picker renders itself.
 *
 * Player entry (volunteer / back off / vote) rides the `act` channel through
 * duelAct; seating rides host actions in state.ts. The hub enforces the
 * result with one check on round.buzzable at the buzz gate.
 */
import type {
  DuelRuleInfo, DuelState, PlayerId, State,
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

/** Who may be seated: connected, and in a teams grouping holding a team. */
export function eligible(state: State): PlayerId[] {
  return state.players
    .filter((p) => p.connected)
    .filter((p) => state.grouping !== 'teams' || !!p.teamId)
    .map((p) => p.id)
}

function teamOf(state: State, playerId: PlayerId): string | undefined {
  return state.players.find((p) => p.id === playerId)?.teamId
}

/**
 * Seat two from a ranked list. In a teams grouping the second seat comes from a
 * different team than the first — a duel inside one team scores for both
 * sides at once, which is no duel.
 */
function twoSeats(state: State, ranked: PlayerId[]): [PlayerId, PlayerId] | null {
  const first = ranked[0]
  if (!first) return null
  if (state.grouping !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(state, id) !== teamOf(state, first))
  return second ? [first, second] : null
}

/**
 * The seated pair per the duel's rule, or null when the pool cannot fill
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

/**
 * A player's duel act. Every path validates against the rule's gates before
 * touching the pool; false means dropped and nothing mutated. Deliberately
 * does not run entrants through `eligible()` — a disconnect between entry and
 * close is fine because `resolveDuel`/`seatDuel` re-filter against it before
 * anyone is actually seated.
 */
export function duelAct(
  state: State,
  playerId: PlayerId,
  act: string,
  data?: unknown,
): boolean {
  const duel = state.duel
  if (!duel || duel.seated) return false
  const rule = duelRule(duel.rule)
  if (!rule) return false
  const takesVotes = rule.entry === 'vote' || rule.entry === 'both'
  const takesVolunteers = rule.entry === 'volunteer' || rule.entry === 'both'
  const mine = duel.pool.find((e) => e.playerId === playerId)

  if (act === 'duelVolunteer') {
    if (!takesVolunteers || mine?.in) return false
    if (mine) mine.in = true
    else duel.pool.push({ playerId, votes: [], in: true })
    return true
  }

  if (act === 'duelBackOff') {
    if (!takesVolunteers || !mine?.in) return false
    mine.in = false
    return true
  }

  if (act === 'duelVote') {
    if (!takesVotes || typeof data !== 'string') return false
    if (data === playerId) return false // a vote is for someone else
    if (!eligible(state).includes(data)) return false
    // In a teams grouping you nominate your own side's player, because that is what
    // the seat is: one from each team, chosen by the people who have to live
    // with it. Voting across the line is picking your opponent's champion,
    // which is either a courtesy or sabotage and never a nomination.
    //
    // Enforced here and not only in the phone's roster: a rule the client is
    // the sole keeper of is a rule one hand-built message walks through.
    if (state.grouping === 'teams' && teamOf(state, playerId) !== teamOf(state, data)) return false
    // One vote per player: lift it off whoever held it, then place it.
    let held = false
    for (const e of duel.pool) {
      const at = e.votes.indexOf(playerId)
      if (at >= 0) {
        e.votes.splice(at, 1)
        held = e.playerId === data
      }
    }
    // Voting for whoever you already backed takes the vote away instead of
    // re-placing it — the same gesture in reverse, which is what `duelBackOff`
    // is to volunteering. The emptied entry stays in the pool at zero: a name
    // that vanished the moment its last vote left would read as a bug from
    // across the room, and `resolveDuel` ignores zero-vote entries anyway.
    if (held) return true
    const target = duel.pool.find((e) => e.playerId === data)
    if (target) target.votes.push(playerId)
    else duel.pool.push({ playerId: data, votes: [playerId], in: false })
    return true
  }

  return false
}

/**
 * Seat an explicit pair (host override, and the only path for resolve:'host'
 * rules). The gates constrain entry; this constrains the result.
 */
export function seatDuel(state: State, ids: [PlayerId, PlayerId]): boolean {
  const duel = state.duel
  if (!duel || duel.seated) return false
  const [a, b] = ids
  if (!a || !b || a === b) return false
  const ok = new Set(eligible(state))
  if (!ok.has(a) || !ok.has(b)) return false
  if (state.grouping === 'teams' && teamOf(state, a) === teamOf(state, b)) return false
  duel.seated = [a, b]
  return true
}

/**
 * Fresh-question stamp. Called from the `arm` host action only — a `wrong`
 * rebound re-arms without passing through it, which is what keeps `missed`
 * alive across the rebound.
 */
export function duelOnArm(state: State): void {
  const duel = state.duel
  if (!duel?.seated) return
  duel.missed = []
  state.round.buzzable = [...duel.seated]
}

/** The exclusive rebound: the leader is out, the other seated player stands alone. */
export function duelOnWrong(state: State, leaderId: PlayerId): void {
  const duel = state.duel
  if (!duel?.seated) return
  if (!duel.missed.includes(leaderId)) duel.missed.push(leaderId)
  state.round.buzzable = duel.seated.filter((id) => !duel.missed.includes(id))
}
