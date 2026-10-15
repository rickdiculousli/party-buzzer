import type { PlayerId, Reveal, Round, ScoreKey, State } from './protocol.ts'

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

/** How far a picture reveal has got at server time `at`: 0 at `from`, 1 at `until`, clamped. */
export function revealProgress(reveal: Reveal, at: number): number {
  const span = reveal.until - reveal.from
  if (span <= 0) return at < reveal.from ? 0 : 1
  return Math.min(1, Math.max(0, (at - reveal.from) / span))
}

/**
 * What a buzz at server time `at` multiplies a picture reveal's value by: 2 in
 * the first quarter of the reveal (and before it), a quarter less in each
 * quarter after, and 1 once the picture is sharp.
 */
export function revealMultiplier(reveal: Reveal, at: number): number {
  if (at >= reveal.until) return 1
  return 2 - Math.floor(revealProgress(reveal, at) * 4) / 4
}

/** The value on offer at server time `at`, in whole points. */
export function revealValue(value: number, reveal: Reveal, at: number): number {
  return Math.round(value * revealMultiplier(reveal, at))
}

/**
 * Where a picture reveal stands still, or undefined while it is refining: a
 * miss holds it until the rebound opens, and a leader holds it at their
 * press. The leader's clamped stamp is the same time the payoff is read from,
 * so the picture and the stamp agree.
 */
export function revealHeldAt(round: Pick<Round, 'reveal' | 'order'>): number | undefined {
  return round.reveal?.heldAt ?? (round.reveal ? round.order[0]?.at : undefined)
}

/** What the round pays its leader if they are right: the reveal's value at their press, else the round value. */
export function leaderValue(round: Pick<Round, 'reveal' | 'order' | 'value'>): number {
  const at = round.order[0]?.at
  return round.reveal && at !== undefined ? revealValue(round.value, round.reveal, at) : round.value
}

/** A held reveal carried on from where it stopped, starting again at server time `at`. */
export function resumeReveal(reveal: Reveal, at: number): Reveal {
  if (reveal.heldAt === undefined) return reveal
  const done = Math.min(reveal.until, Math.max(reveal.from, reveal.heldAt)) - reveal.from
  return { from: at - done, until: at - done + (reveal.until - reveal.from) }
}
