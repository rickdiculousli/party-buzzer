import type { ScoreKey, State } from '../shared/protocol.ts'

const IDS = ['var(--id-1)', 'var(--id-2)', 'var(--id-3)', 'var(--id-4)', 'var(--id-5)', 'var(--id-6)']

/**
 * A stable identity colour for anyone without one. Hashing the id rather than
 * using position keeps a player the same colour when someone above them leaves.
 */
export function colorFor(key: ScoreKey): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return IDS[Math.abs(h) % IDS.length]
}

export type Standing = { key: ScoreKey; label: string; color: string; score: number }

/** Whoever holds the score this game: teams in teams mode, players in solo. */
export function standings(state: State, sorted = true): Standing[] {
  const rows: Standing[] =
    state.mode === 'teams'
      ? state.teams.map((t) => ({ key: t.id, label: t.name, color: t.color, score: 0 }))
      : state.players.map((p) => ({ key: p.id, label: p.name, color: colorFor(p.id), score: 0 }))
  const withScores = rows.map((r) => ({ ...r, score: state.scores[r.key] ?? 0 }))
  return sorted ? withScores.sort((a, b) => b.score - a.score) : withScores
}

/** The identity colour of the thing a buzz scores for. */
export function colorForPlayer(state: State, playerId: string): string {
  const team = state.mode === 'teams'
    ? state.teams.find((t) => t.id === state.players.find((p) => p.id === playerId)?.teamId)
    : undefined
  return team?.color ?? colorFor(playerId)
}

/** Locked-out score keys as the names the room recognises. */
export function lockedNames(state: State): string[] {
  return state.round.lockedOut.map(
    (k) =>
      state.teams.find((t) => t.id === k)?.name ??
      state.players.find((p) => p.id === k)?.name ??
      '?',
  )
}
