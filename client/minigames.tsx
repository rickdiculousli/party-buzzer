import type { ComponentType } from 'preact'
import type { ClientMsg, MinigameFrame, MinigameId, MinigameInputAck, State } from '../shared/protocol.ts'
import type { TimedTouch } from './ink.ts'
import { MINIGAME_INFO } from './minigame-info.ts'
import { BowBoard } from './BowBoard.tsx'
import { BowPlayer } from './BowPlayer.tsx'
import { TankBoard } from './TankBoard.tsx'
import { TankPlayer } from './TankPlayer.tsx'
import { InkBoard } from './InkBoard.tsx'
import { InkPlayer } from './InkPlayer.tsx'
import { SketchBoard } from './SketchBoard.tsx'
import { SketchPlayer } from './SketchPlayer.tsx'
import { PokerBoard } from './PokerBoard.tsx'
import { PokerPlayer } from './PokerPlayer.tsx'
import { TugBoard } from './TugBoard.tsx'
import { TugPlayer } from './TugPlayer.tsx'

export type MinigamePlayerProps = {
  state: State
  playerId: string | null
  connected?: boolean
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: MinigameInputAck | null
  touches: TimedTouch[]
}

export type MinigameBoardProps = {
  state: State
  frame: MinigameFrame | null
  now: () => number
  touches: TimedTouch[]
  join: boolean
}

export type MinigameEntry = {
  name: string
  timed: boolean
  picksTeams: boolean
  player: ComponentType<MinigamePlayerProps>
  board: ComponentType<MinigameBoardProps>
}

export const MINIGAMES: Record<MinigameId, MinigameEntry> = {
  bow: { ...MINIGAME_INFO.bow, player: BowPlayer, board: BowBoard },
  tank: { ...MINIGAME_INFO.tank, player: TankPlayer, board: TankBoard },
  ink: { ...MINIGAME_INFO.ink, player: InkPlayer, board: InkBoard },
  sketch: { ...MINIGAME_INFO.sketch, player: SketchPlayer, board: SketchBoard },
  poker: { ...MINIGAME_INFO.poker, player: PokerPlayer, board: PokerBoard },
  tug: { ...MINIGAME_INFO.tug, player: TugPlayer, board: TugBoard },
}
