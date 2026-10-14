import { INK_PEEK_ROWS } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { TEAM_LABEL, stepLine } from './ink.ts'
import { DiscardSlip, InkDefs, InkLobby, InkPad, useInkPad } from './InkParts.tsx'
import { playerName, setlistPosition } from './ui.ts'

/**
 * Phantom Ink on the big screen: its own table, not the quiz's frame. Each
 * team's page is a set angled toward the room, the call runs across the top,
 * and each team's discarded prompts stack on its outer side, newest first.
 */
export function InkBoard({ state, frame, touches }: MinigameBoardProps) {
  const session = state.minigame!
  const ink = matchFrame(frame, 'ink', 'board', session.matchId)
  const pad = useInkPad(ink)
  const nameOf = (id: string) => playerName(state, id)
  const place = setlistPosition(state) ?? 'Phantom Ink'

  if (session.phase === 'ready' || !ink || !pad) {
    return <main class="ink-board">
      <header class="ink-board__bar">
        <span class="chip">{place}</span>
        <h1 class="ink-board__call">Phantom Ink</h1>
      </header>
      <InkLobby state={state} />
    </main>
  }
  const over = ink.step.at === 'over'
  const winner = ink.step.at === 'over' ? ink.step.winner : null
  return <main class={over ? 'ink-board is-over' : 'ink-board'}>
    <InkDefs />
    <header class="ink-board__bar">
      <span class="chip">{place}</span>
      {!over && <span class={`chip ink-team-chip ink-team-chip--${ink.turn}`}>{TEAM_LABEL[ink.turn]}</span>}
      <p class={winner ? `ink-board__call ink-board__call--${winner}` : 'ink-board__call'}>{stepLine(ink, nameOf)}</p>
      {ink.secret && <p key="word" class="board__hero ink-board__word is-awarded">{ink.secret}</p>}
    </header>
    <InkPad state={state} frame={ink} pad={pad} touches={touches} peekRows={INK_PEEK_ROWS} sets aside={(team) =>
      <aside key={`discard-${team}`} class={`ink-discard ink-discard--${team}`}>
        <span class="chip">{TEAM_LABEL[team]} discarded</span>
        {ink.discard[team].length
          ? <ol>{ink.discard[team].map((text, i) => <DiscardSlip key={i} text={text} />).reverse()}</ol>
          : <p class="ink-discard__none">Nothing yet</p>}
      </aside>} />
  </main>
}
