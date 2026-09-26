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

export type MinigameEntry = {
  name: string
  /** Timed games run the runtime clock; an untimed one ends on its own rules. */
  timed: boolean
  /** Players pick sides in the lobby before the match can start. */
  picksTeams: boolean
  player: ComponentType<MinigamePlayerProps>
  board: ComponentType<MinigameBoardProps>
}

/** One row per minigame: everything the client needs to name, host, and draw it. */
export const MINIGAMES: Record<MinigameId, MinigameEntry> = {
  bow: { ...MINIGAME_INFO.bow, player: BowPlayer, board: BowBoard },
  tank: { ...MINIGAME_INFO.tank, player: TankPlayer, board: TankBoard },
  ink: { ...MINIGAME_INFO.ink, player: InkPlayer, board: InkBoard },
  sketch: { ...MINIGAME_INFO.sketch, player: SketchPlayer, board: SketchBoard },
}
