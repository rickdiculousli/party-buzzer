import type { PlayerId, Reveal, Round, ScoreKey, State } from './protocol.ts'

type Roster = Pick<State, 'players' | 'grouping'>

export function scoreKey(state: Roster, playerId: PlayerId): ScoreKey {
  const player = state.players.find((p) => p.id === playerId)
  return state.grouping === 'teams' && player?.teamId ? player.teamId : playerId
}

export function bump(state: Pick<State, 'scores'>, key: ScoreKey, delta: number): void {
  state.scores[key] = (state.scores[key] ?? 0) + delta
}

export function lockedPlayerIds(state: Roster & Pick<State, 'round'>): PlayerId[] {
  const barred = new Set(state.round.lockedOut)
  return state.players.filter((p) => barred.has(scoreKey(state, p.id))).map((p) => p.id)
}

export const CLOSEST_SECOND_FROM = 6

export function closestOff(guess: number, truth: number): number {
  return Math.round(Math.abs(guess - truth) * 1e6) / 1e6
}

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

export function revealProgress(reveal: Reveal, at: number): number {
  const span = reveal.until - reveal.from
  if (span <= 0) return at < reveal.from ? 0 : 1
  return Math.min(1, Math.max(0, (at - reveal.from) / span))
}

export function revealMultiplier(reveal: Reveal, at: number): number {
  if (at >= reveal.until) return 1
  return 2 - Math.floor(revealProgress(reveal, at) * 4) / 4
}

export function revealValue(value: number, reveal: Reveal, at: number): number {
  return Math.round(value * revealMultiplier(reveal, at))
}

export function revealHeldAt(round: Pick<Round, 'reveal' | 'order'>): number | undefined {
  return round.reveal?.heldAt ?? (round.reveal ? round.order[0]?.at : undefined)
}

export function leaderValue(round: Pick<Round, 'reveal' | 'order' | 'value'>): number {
  const at = round.order[0]?.at
  return round.reveal && at !== undefined ? revealValue(round.value, round.reveal, at) : round.value
}

export function resumeReveal(reveal: Reveal, at: number): Reveal {
  if (reveal.heldAt === undefined) return reveal
  const done = Math.min(reveal.until, Math.max(reveal.from, reveal.heldAt)) - reveal.from
  return { from: at - done, until: at - done + (reveal.until - reveal.from) }
}
