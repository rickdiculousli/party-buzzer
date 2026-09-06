import type { PlayerId, ScoreKey, State } from './protocol.ts'

type Roster = Pick<State, 'players' | 'grouping'>

/** Teams score together; an unassigned player keeps their own score. */
export function scoreKey(state: Roster, playerId: PlayerId): ScoreKey {
  const player = state.players.find((p) => p.id === playerId)
  return state.grouping === 'teams' && player?.teamId ? player.teamId : playerId
}

export function bump(state: Pick<State, 'scores'>, key: ScoreKey, delta: number): void {
  state.scores[key] = (state.scores[key] ?? 0) + delta
}

/** Expand barred score keys into the players excluded from buzz resolution. */
export function lockedPlayerIds(state: Roster & Pick<State, 'round'>): PlayerId[] {
  const barred = new Set(state.round.lockedOut)
  return state.players.filter((p) => barred.has(scoreKey(state, p.id))).map((p) => p.id)
}
