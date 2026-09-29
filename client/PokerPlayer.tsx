import type { PokerInput } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { PendingBar } from './InkParts.tsx'
import { playerName } from './ui.ts'

export function PokerPlayer({ state, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'player', session.matchId)
  if (!poker) return <main class="player"><PendingBar label={frame?.role === 'spectator' ? 'Watching this game' : 'Starting'} /></main>
  const input = (value: { kind: PokerInput["kind"] } & Record<string, unknown>) => send({
    t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: { ...value, at: now() } as PokerInput,
  })
  const legal = poker.legal
  return <main class="player">
    <p>{poker.hole?.join(' ') ?? 'Out'}</p>
    <p>{poker.actor ? `${playerName(state, poker.actor)} to act` : ''}</p>
    {legal && <div class="host__minor">
      <button class="btn" onClick={() => input({ kind: 'fold' })}>Fold</button>
      <button class="btn" onClick={() => input({ kind: legal.canCheck ? 'check' : 'call' })}>{legal.canCheck ? 'Check' : `Call ${legal.call}`}</button>
      {legal.canRaise && <button class="btn" onClick={() => input({ kind: 'raise', to: legal.minTo })}>Raise to {legal.minTo}</button>}
      <button class="btn" onClick={() => input({ kind: 'allIn' })}>All in</button>
    </div>}
    {poker.canShow && <button class="btn" onClick={() => input({ kind: 'show' })}>Show</button>}
  </main>
}
