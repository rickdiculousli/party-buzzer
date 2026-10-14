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

/** A closest question's second place pays from this many guessers up. */
export const CLOSEST_SECOND_FROM = 6

/** How far a guess is from the answer. Rounded so 1.1 and 0.9 tie around 1, as the room would expect. */
export function closestOff(guess: number, truth: number): number {
  return Math.round(Math.abs(guess - truth) * 1e6) / 1e6
}

/**
 * What a closest question pays, by player: the nearest guess takes the value,
 * doubled for an exact hit; with six or more guessers the next-nearest takes
 * half. Players tied at a distance share its pot, rounded to whole points.
 * Only players who score appear.
 */
export function closestAwards(guesses: Record<PlayerId, number>, truth: number, value: number): Record<PlayerId, number> {
  const off = Object.entries(guesses).map(([id, g]) => ({ id, d: closestOff(g, truth) }))
  const distances = [...new Set(off.map((o) => o.d))].sort((a, b) => a - b)
  const pots = [distances[0] === 0 ? value * 2 : value]
  if (off.length >= CLOSEST_SECOND_FROM) pots.push(value / 2)
  const paid: Record<PlayerId, number> = {}
  pots.forEach((pot, place) => {
    const at = distances[place]
    if (at === undefined) return
    const tied = off.filter((o) => o.d === at)
    const share = Math.round(pot / tied.length)
    if (share) for (const o of tied) paid[o.id] = share
  })
  return paid
}
