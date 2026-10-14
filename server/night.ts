/**
 * The night: pure predicates behind the hub's autoplay across blocks. The hub
 * owns the timers and sends every step through `dispatch`; this only answers
 * what is true of a state and what should begin once an introduction is gone.
 */
import { isMinigameId, type MinigameId, type PlayerId, type State } from '../shared/protocol.ts'

/** How long an open minigame waits for Ready before the match starts anyway. */
export const READY_FALLBACK_MS = 60_000

export function connectedIds(state: State): PlayerId[] {
  return state.players.filter((p) => p.connected).map((p) => p.id)
}

/** Every connected player, and at least one, has tapped Ready in the open minigame's lobby. */
export function everyoneReady(state: State): boolean {
  const ready = state.minigame?.lobby?.ready ?? []
  const connected = connectedIds(state)
  return connected.length > 0 && connected.every((id) => ready.includes(id))
}

export type Begin =
  | { do: 'prepare'; id: MinigameId; options: Record<string, unknown> }
  | { do: 'read' }

/**
 * What an introduction's dismissal sets going, for the block the setlist is on:
 * a minigame other than Poker opens its match, a block with a pack starts the
 * reader. Poker and a block with no pack are the host's turn.
 */
export function beginFor(state: State): Begin | null {
  const setlist = state.setlist
  const block = setlist?.blocks[setlist.at]
  if (!state.autoplay.on || !block) return null
  if (isMinigameId(block.game)) {
    return block.game === 'poker' || state.minigame ? null : { do: 'prepare', id: block.game, options: block.options }
  }
  return block.pack ? { do: 'read' } : null
}
