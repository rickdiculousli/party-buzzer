import type { ComponentType } from 'preact'
import type { ClientMsg, MinigameFrame, MinigameId, MinigameInputAck, State } from '../shared/protocol.ts'
import { BowBoard } from './BowBoard.tsx'
import { BowPlayer } from './BowPlayer.tsx'
import { TankBoard } from './TankBoard.tsx'
import { TankPlayer } from './TankPlayer.tsx'

export type MinigamePlayerProps = {
  state: State
  playerId: string | null
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: MinigameInputAck | null
}

export type MinigameBoardProps = { state: State; frame: MinigameFrame | null; now: () => number }

export const MINIGAME_PLAYERS: Record<MinigameId, ComponentType<MinigamePlayerProps>> = {
  bow: BowPlayer,
  tank: TankPlayer,
}

export const MINIGAME_BOARDS: Record<MinigameId, ComponentType<MinigameBoardProps>> = {
  bow: BowBoard,
  tank: TankBoard,
}
