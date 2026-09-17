import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { TEAM_LABEL, stepLine } from './ink.ts'
import { InkLobby, InkPad, useInkPad, useTouchClock } from './InkParts.tsx'

export function InkBoard({ state, frame, touches }: MinigameBoardProps) {
  const session = state.minigame!
  const ink = frame?.role === 'board' && frame.id === 'ink' && frame.matchId === session.matchId ? frame : null
  const pad = useInkPad(ink)
  useTouchClock(touches)
  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'

  if (session.phase === 'ready' || !ink || !pad) {
    return <main class="ink-board">
      <h1 class="ink-board__title">Phantom Ink</h1>
      <InkLobby state={state} />
    </main>
  }
  return <main class="ink-board">
    <header class="ink-board__bar">
      <span class={`chip ink-turn ink-turn--${ink.turn}`}>{TEAM_LABEL[ink.turn]}</span>
      <span class="ink-board__step">{stepLine(ink, nameOf)}</span>
      {ink.secret && <span class="ink-board__secret">{ink.secret}</span>}
    </header>
    <InkPad state={state} frame={ink} pad={pad} touches={touches} peekRows={INK_PEEK_ROWS} />
    <footer class="ink-board__foot">
      {(['sun', 'moon'] as const).map((team) => <p key={team} class="muted">
        {TEAM_LABEL[team]}: {nameOf(ink.roster[team].writer)} writes · {ink.roster[team].guessers.map(nameOf).join(', ')}
      </p>)}
      <p class="eyebrow">Discarded</p>
      <ul class="ink-discard">{ink.discard.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </footer>
  </main>
}
