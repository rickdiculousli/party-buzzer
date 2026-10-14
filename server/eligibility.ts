import type { PlayerId, State } from '../shared/protocol.ts'
import { pickers } from '../shared/choice.ts'
import { moduleFor } from './modes/index.ts'

/** Effects and mode restrictions; score-key lockouts are resolved separately. */
export function buzzBlockReason(state: State, playerId: PlayerId): string | null {
  // The whole room answers a choice question on its phones; there is no buzz to win.
  if (state.round.kind === 'choice') return 'choice'
  if (state.round.kind === 'closest') return 'closest'
  const frozen = state.effects.some((e) =>
    e.kind === 'frozen' && e.playerId === playerId && e.attemptId === state.round.attemptId,
  )
  if (frozen) return 'frozen'
  return moduleFor(state.game.id).canBuzz?.(state, playerId) ?? null
}

/** Why this player may not pick right now, or null. A pick is final. */
export function pickBlockReason(state: State, playerId: PlayerId, at = Date.now()): string | null {
  const r = state.round
  if (r.kind !== 'choice' || !r.choices || r.correct !== undefined) return 'not-picking'
  if (r.closesAt !== undefined && at >= r.closesAt) return 'closed'
  if (r.picks?.[playerId] !== undefined) return 'picked'
  if (!pickers(state).includes(playerId)) return 'not-eligible'
  return null
}

/** Why this player may not guess right now, or null. A guess is final, and a number. */
export function guessBlockReason(state: State, playerId: PlayerId, guess: unknown, at = Date.now()): string | null {
  const r = state.round
  if (r.kind !== 'closest' || !r.guessing || r.truth !== undefined) return 'not-guessing'
  if (typeof guess !== 'number' || !Number.isFinite(guess)) return 'not-a-number'
  if (at >= r.guessing.closesAt) return 'closed'
  if (r.guesses?.[playerId] !== undefined) return 'guessed'
  if (!pickers(state).includes(playerId)) return 'not-eligible'
  return null
}
