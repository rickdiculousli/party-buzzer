import { MINIGAME_OPTIONS, type GameInfo, type MinigameFrame, type MinigameId } from '../shared/protocol.ts'

/**
 * The JSX-free half of the minigame client, so plain tests can read it.
 * `timed` mirrors the server definition's `untimed`; minigames.test.ts holds
 * the two sides together.
 */
export const MINIGAME_INFO: Record<MinigameId, { name: string; timed: boolean; picksTeams: boolean }> = {
  bow: { name: 'Bow', timed: true, picksTeams: false },
  tank: { name: 'Tank battle', timed: true, picksTeams: false },
  ink: { name: 'Phantom Ink', timed: false, picksTeams: true },
}

/** The minigames in the shape the modes ship, so one picker and one options form serve both. */
export const MINIGAME_CATALOG: GameInfo[] = (Object.keys(MINIGAME_INFO) as MinigameId[])
  .map((id) => ({ id, name: MINIGAME_INFO[id].name, options: MINIGAME_OPTIONS[id] }))

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
