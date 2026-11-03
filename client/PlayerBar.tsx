import type { ComponentChildren } from 'preact'
import type { State } from '../shared/protocol.ts'
import { ScoreChange } from './fx.tsx'
import { colorForPlayer, playerName } from './ui.ts'

/** The phone's status bar: whose phone, whether it is connected, and the score when the game keeps one. */
export function PlayerBar({ state, playerId, connected, score, children }: {
  state: State
  playerId: string | null
  connected?: boolean
  score?: number
  children?: ComponentChildren
}) {
  return <div class="player__bar">
    <span class="player__name" style={{ '--id': playerId ? colorForPlayer(state, playerId) : undefined }}>{playerName(state, playerId ?? '')}</span>
    <Lamp connected={connected} />
    {score !== undefined && <ScoreChange class="player__score readout" score={score} />}
    {children}
  </div>
}

export function Lamp({ connected }: { connected?: boolean }) {
  return <span class="lamp">
    <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
    {connected ? 'Connected' : 'Disconnected'}
  </span>
}
