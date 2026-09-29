import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { playerName } from './ui.ts'

export function PokerBoard({ state, frame }: MinigameBoardProps) {
  const session = state.minigame!
  if (session.phase === 'results') return <main class="board">
    <ol>{[...session.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0)).map((row) =>
      <li key={row.playerId}>{row.place}. {playerName(state, row.playerId)}</li>)}</ol>
  </main>
  const poker = matchFrame(frame, 'poker', 'board', session.matchId)
  if (!poker) return <main class="board"><p>Poker</p></main>
  return <main class="board">
    <p>Hand {poker.handNo} · Blinds {poker.sb} / {poker.bb} · Pot {poker.pots.join(' + ')}</p>
    <p>{poker.board.join(' ')}</p>
    <ul>{poker.seats.map((seat) => <li key={seat.player}>
      {playerName(state, seat.player)} {seat.stack} {seat.bet ? `(${seat.bet})` : ''} {seat.cards?.join(' ')}
      {seat.player === poker.actor ? ' ←' : ''}
    </li>)}</ul>
  </main>
}
