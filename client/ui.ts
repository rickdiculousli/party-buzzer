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

/**
 * What the phone's big button says, in priority order.
 *
 * Pure, and out here rather than inline in `Player`, because the ordering is
 * the whole of it and the ordering is what keeps going wrong. Every bug in it
 * so far has been the same shape: a branch that matched in a state its author
 * was not thinking about, because the state before it had stopped matching. A
 * list of cases is easy to read and hard to reason about; a test that walks one
 * question end to end catches the next one.
 *
 * Two rules hold it together. Only the player actually answering gets a screen
 * of their own — everyone else is some flavour of "not you", and flavouring it
 * further just puts information on a phone whose job right now is to be quiet.
 * And the phone never learns anything the room has not been told: `viewFor`
 * redacts the buzz order down to your own entry, so there is no name to show
 * even if it wanted to.
 */
export type Face = { label: string; sub: string; mood: string }
export function buzzerFace(f: {
  frozen: boolean
  barred: boolean
  /** A duel where both finalists missed. */
  dead: boolean
  /** A duel this player is not in. */
  spectator: boolean
  finalistNames?: string[]
  /** This player is first in the order. */
  won: boolean
  /** Their margin behind first, when they buzzed and did not win. */
  deltaMs?: number
  /** The round is LOCKED: somebody is answering. */
  answering: boolean
  /** A miss is up and its rebound has not opened yet. */
  held: boolean
  /** This phone has pressed for this arm. Local, not from the order. */
  pressed: boolean
  /** ARMED or COLLECTING — the round is live. */
  armed: boolean
  /** Past the arm instant: the buzzers are actually open. */
  open: boolean
}): Face {
  if (f.frozen) {
    return { label: 'Frozen', sub: 'A freeze item shut you out of this question', mood: 'is-barred' }
  }
  if (f.barred) {
    return {
      label: 'Out',
      sub: 'Wrong answer — you sit out the rest of this question',
      mood: 'is-barred',
    }
  }
  if (f.dead) return { label: 'Duel', sub: 'Both missed — waiting for the host', mood: 'is-barred' }
  if (f.spectator) {
    return {
      label: 'Duel',
      sub: `${f.finalistNames?.join(' vs ')} — you sit this one out`,
      mood: 'is-barred',
    }
  }
  if (f.won && f.answering) return { label: 'You’re up', sub: 'Answer it', mood: 'is-first' }
  // The press has gone but the window is still filling, and the room learns
  // nothing for a whole second.
  //
  // `armed`, not "not locked". `pressed` is keyed on the arm, so it stays true
  // for the whole question however that question ends — and a scored one ends
  // IDLE, which is neither armed nor locked. Second place kept falling back
  // through to "In" the moment the host pressed C. Gating on the round still
  // being live covers every way it can stop being live.
  if (f.pressed && f.armed) {
    return { label: 'In', sub: 'Counting the rest of the field', mood: 'is-placed' }
  }
  // Second place is locked too. It used to get a placement readout of its own,
  // which is a result on a screen whose only job is to say "not you" — and the
  // margin is on the board, in front of the whole room, already.
  if (f.answering || f.held) {
    return {
      label: 'Locked',
      sub: f.held ? 'Reopening in a moment' : f.deltaMs ? `+${f.deltaMs} ms` : '',
      mood: 'is-barred',
    }
  }
  if (f.open) return { label: 'Buzz', sub: '', mood: 'is-open' }
  if (f.armed) return { label: 'Wait', sub: 'Any moment', mood: '' }
  return { label: 'Wait', sub: 'The host has not armed yet', mood: '' }
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
  return state.players.filter((p) => p.connected && (state.mode !== 'teams' || !!p.teamId))
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
  if (state.mode !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(id) !== teamOf(first))
  return second ? [first, second] : null
}
