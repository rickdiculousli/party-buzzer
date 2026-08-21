import type { ScoreKey, State } from '../shared/protocol.ts'
import type { Refusal } from '../shared/legality.ts'

/**
 * A refusal, in words the host can act on.
 *
 * `shared/legality.ts` returns a code and nothing else, for the same reason
 * `shared/wall.ts` returns `penalised` rather than `red`: the identity is the
 * contract, the words are the surface's. This is the host's half of that split,
 * and it is a `Record<Refusal, string>` on purpose — a ninth code does not
 * typecheck until somebody has written its sentence, which is the only thing
 * standing between this and a tooltip that says "not-idle".
 *
 * The voice is `closeBlockReason`'s: state the fact, then the consequence, and
 * where there is something the host can press instead, name it. A host reads
 * these one-handed with a room waiting.
 */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  // "Round", not "question": §9 keeps them apart, and what is in flight is the
  // arm-to-verdict cycle, which is still running through a hold and a rebound
  // after the question itself has been read out.
  'not-idle': 'A round is in flight — this waits for it to end.',
  'no-leader': 'Nobody is locked in — there is nothing to judge yet.',
  'already-scored': 'This round is already scored — Undo first to change it.',
  'nothing-held': 'No miss is being held — there is no rebound to open.',
  'no-duel': 'No duel is open — there is nothing to close.',
  'duel-seated': 'The pair is already seated — Cancel ends the duel.',
  'unknown-mode': 'This room has no game by that name.',
  'unknown-duel-rule': 'This room has no duel rule by that name.',
  'no-setlist': 'There is no setlist to move through.',
}

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

/**
 * Words grouped for the typewriter reveal: mostly pairs, a single every third
 * beat so the rhythm reads as a person typing rather than a metronome.
 */
export function chunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < words.length; ) {
    const n = out.length % 3 === 0 ? 1 : 2
    out.push(words.slice(i, i + n).join(' '))
    i += n
  }
  return out
}

export type Standing = { key: ScoreKey; label: string; color: string; score: number }

/** Whoever holds the score this game: teams in a teams grouping, players in solo. */
export function standings(state: State, sorted = true): Standing[] {
  const rows: Standing[] =
    state.grouping === 'teams'
      ? state.teams.map((t) => ({ key: t.id, label: t.name, color: t.color, score: 0 }))
      : state.players.map((p) => ({ key: p.id, label: p.name, color: colorFor(p.id), score: 0 }))
  const withScores = rows.map((r) => ({ ...r, score: state.scores[r.key] ?? 0 }))
  return sorted ? withScores.sort((a, b) => b.score - a.score) : withScores
}

/** The identity colour of the thing a buzz scores for. */
export function colorForPlayer(state: State, playerId: string): string {
  const team = state.grouping === 'teams'
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

/** Who a duel may seat: connected, and on a team when the game has them. */
export function eligibleForDuel(state: State) {
  return state.players.filter((p) => p.connected && (state.grouping !== 'teams' || !!p.teamId))
}

/**
 * The pair a `votes` duel would seat if the host closed the window right now.
 *
 * Same ranking and one-per-team logic as `resolveDuel` in server/duel.ts,
 * duplicated here for display only — the actual seat is still decided
 * server-side when the host closes, and this never mutates anything. It lives
 * in one place because two surfaces predict it: the host desk highlights the
 * pair it would seat, and the board marks the same names for the room. Those
 * two disagreeing is worse than either being wrong.
 *
 * Null for every rule that does not resolve by votes. A random draw genuinely
 * has no leader, and lighting up the two loudest names would promise the room
 * an outcome the coin is about to ignore.
 */
export function willSeat(state: State): [ScoreKey, ScoreKey] | null {
  const duel = state.duel
  const rule = state.duelRules.find((r) => r.id === duel?.rule)
  if (!duel || duel.seated || rule?.resolve !== 'votes') return null

  const eligible = new Set(eligibleForDuel(state).map((p) => p.id))
  const teamOf = (id: string) => state.players.find((p) => p.id === id)?.teamId
  const ranked = duel.pool
    .filter((e) => e.votes.length > 0 && eligible.has(e.playerId))
    .sort((a, b) => b.votes.length - a.votes.length)
    .map((e) => e.playerId)

  const first = ranked[0]
  if (!first) return null
  if (state.grouping !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(id) !== teamOf(first))
  return second ? [first, second] : null
}
