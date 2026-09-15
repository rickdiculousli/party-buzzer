import type { ComponentType } from 'preact'
import type { ClientMsg, MinigameFrame, MinigameId, MinigameInputAck, State } from '../shared/protocol.ts'
import { BowPlayer } from './BowPlayer.tsx'
import { TankPlayer } from './TankPlayer.tsx'

export type MinigamePlayerProps = {
  state: State
  playerId: string | null
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: MinigameInputAck | null
}

export const MINIGAME_PLAYERS: Record<MinigameId, ComponentType<MinigamePlayerProps>> = {
  bow: BowPlayer,
  tank: TankPlayer,
}
