import type { ComponentType } from 'preact'
import type { ClientMsg, MinigameFrame, MinigameId, MinigameInputAck, State } from '../shared/protocol.ts'
import type { TimedTouch } from './ink.ts'
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
  touches: TimedTouch[]
}

export type MinigameBoardProps = { state: State; frame: MinigameFrame | null; now: () => number; touches: TimedTouch[] }

export const MINIGAME_NAMES: Record<MinigameId, string> = { bow: 'Bow', tank: 'Tank battle', ink: 'Phantom Ink' }

export const MINIGAME_PLAYERS: Record<MinigameId, ComponentType<MinigamePlayerProps>> = {
  bow: BowPlayer,
  tank: TankPlayer,
  ink: BowPlayer,
}

export const MINIGAME_BOARDS: Record<MinigameId, ComponentType<MinigameBoardProps>> = {
  bow: BowBoard,
  tank: TankBoard,
  ink: BowBoard,
}
