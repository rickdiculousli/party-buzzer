import { isMinigameId, type MinigameId, type PlayerId, type State } from '../shared/protocol.ts'

export const READY_FALLBACK_MS = 60_000

export function connectedIds(state: State): PlayerId[] {
  return state.players.filter((p) => p.connected).map((p) => p.id)
}

export function everyoneReady(state: State): boolean {
  const ready = state.minigame?.lobby?.ready ?? []
  const connected = connectedIds(state)
  return connected.length > 0 && connected.every((id) => ready.includes(id))
}

export type Begin =
  | { do: 'prepare'; id: MinigameId; options: Record<string, unknown> }
  | { do: 'read' }

export function beginFor(state: State): Begin | null {
  const setlist = state.setlist
  const block = setlist?.blocks[setlist.at]
  if (!state.autoplay.on || !block) return null
  if (state.minigame) return null
  if (isMinigameId(block.game)) {
    return block.game === 'poker' ? null : { do: 'prepare', id: block.game, options: block.options }
  }
  return block.pack ? { do: 'read' } : null
}
