import { MINIGAME_OPTIONS, type GameInfo, type MinigameFrame, type MinigameId, type MinigamePhase } from '../shared/protocol.ts'

export const MINIGAME_INFO: Record<MinigameId, { name: string; timed: boolean; picksTeams: boolean }> = {
  bow: { name: 'Bow', timed: true, picksTeams: false },
  tank: { name: 'Tank battle', timed: true, picksTeams: false },
  ink: { name: 'Phantom Ink', timed: false, picksTeams: true },
  sketch: { name: 'Sketch', timed: false, picksTeams: false },
  poker: { name: 'Poker', timed: false, picksTeams: false },
  tug: { name: 'Tug of war', timed: true, picksTeams: false },
}

export const joinShown = (id: MinigameId, phase: MinigamePhase): boolean =>
  !MINIGAME_INFO[id].timed || phase === 'ready' || phase === 'results'

export const MINIGAME_CATALOG: GameInfo[] = (Object.keys(MINIGAME_INFO) as MinigameId[])
  .map((id) => ({ id, name: MINIGAME_INFO[id].name, options: MINIGAME_OPTIONS[id] }))

export function matchFrame<I extends MinigameId, R extends 'board' | 'player'>(
  frame: MinigameFrame | null, id: I, role: R, matchId: string,
): Extract<MinigameFrame, { id: I; role: R }> | null {
  return frame?.id === id && frame.role === role && frame.matchId === matchId
    ? frame as Extract<MinigameFrame, { id: I; role: R }>
    : null
}
