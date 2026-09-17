import type { MinigameFrame, MinigameId } from '../shared/protocol.ts'

/**
 * The JSX-free half of the minigame client, so plain tests can read it.
 * `timed` mirrors the server definition's `untimed`; minigames.test.ts holds
 * the two sides together.
 */
export const MINIGAME_INFO: Record<MinigameId, { name: string; timed: boolean }> = {
  bow: { name: 'Bow', timed: true },
  tank: { name: 'Tank battle', timed: true },
  ink: { name: 'Phantom Ink', timed: false },
}

/**
 * The frame this surface may draw: the right game, the right role, and the
 * match the session is on, so a frame from the previous match never renders.
 */
export function matchFrame<I extends MinigameId, R extends 'board' | 'player'>(
  frame: MinigameFrame | null, id: I, role: R, matchId: string,
): Extract<MinigameFrame, { id: I; role: R }> | null {
  return frame?.id === id && frame.role === role && frame.matchId === matchId
    ? frame as Extract<MinigameFrame, { id: I; role: R }>
    : null
}
