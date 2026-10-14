import './arrival-board.css'
import { activePracticePlayers, practiceLobbyId, type PracticeFeedback } from './arrival-feedback.ts'
import { colorForPlayer } from './ui.ts'
import { NEXT_LABEL, type ArrivalPresentation } from '../shared/arrival.ts'
import type { State } from '../shared/protocol.ts'

/**
 * The wall while the room arrives: the roster with a tested mark per player, or
 * the first block's introduction. The parent owns the QR and picks the moment;
 * this renders the presentation it is handed. Names and colours come from the
 * current roster, never from receipts.
 */
export function ArrivalBoard({ state, arrival, feedback, pulseNow }: {
  state: State
  arrival: ArrivalPresentation
  feedback: PracticeFeedback
  pulseNow: number
}) {
  if (arrival.kind === 'introduction') {
    return (
      <div class="arrival-board" data-review-id="board:arrival-introduction">
        <p class="eyebrow arrival-board__label">{arrival.next ? NEXT_LABEL : 'First block'}</p>
        <h2 class="arrival-board__title fx-rise">{arrival.title}</h2>
        <p class="arrival-board__goal">{arrival.goal}</p>
        {arrival.detail && <p class="arrival-board__goal">{arrival.detail}</p>}
      </div>
    )
  }

  const lobbyId = practiceLobbyId(state)
  const lit = activePracticePlayers(feedback, lobbyId, pulseNow)
  const tested = state.arrival?.kind === 'lobby' ? state.arrival.testedPlayerIds : []
  return (
    <div class="arrival-board" data-review-id="board:arrival-lobby">
      <h2 class="arrival-board__title">Test buzzer</h2>
      <p class="arrival-board__goal">Practice only · no points</p>
      <ul class="arrival-board__roster" data-review-id="board:arrival-roster">
        {state.players.map((p) => {
          const on = lit.includes(p.id)
          const seq = feedback.pulses[p.id]?.seq ?? 0
          return (
            <li
              key={p.id}
              class={on ? 'arrival-board__player is-lit' : 'arrival-board__player'}
              style={{ '--id': colorForPlayer(state, p.id), '--fx-color': colorForPlayer(state, p.id) }}
            >
              {/* Keyed on the receipt so a repeat press replays the flash. */}
              <span key={on ? seq : 0} class={on ? 'arrival-board__name fx-flash fx-flash--tint' : 'arrival-board__name'}>
                {p.name}
              </span>
              <span class={tested.includes(p.id) ? 'chip chip--won' : 'chip'}>
                {tested.includes(p.id) ? 'Tested' : 'Not yet'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
