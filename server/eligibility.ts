import type { PlayerId, State } from '../shared/protocol.ts'
import { moduleFor } from './modes/index.ts'

/** Effects and mode restrictions; score-key lockouts are resolved separately. */
export function buzzBlockReason(state: State, playerId: PlayerId): string | null {
  const frozen = state.effects.some((e) =>
    e.kind === 'frozen' && e.playerId === playerId && e.attemptId === state.round.attemptId,
  )
  if (frozen) return 'frozen'
  return moduleFor(state.game.id).canBuzz?.(state, playerId) ?? null
}
