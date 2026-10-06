import './arrival-phone.css'
import { activePracticePlayers, practiceLobbyId, type PracticeFeedback } from './arrival-feedback.ts'
import type { ArrivalPresentation } from '../shared/arrival.ts'
import type { PlayerId, State } from '../shared/protocol.ts'

/**
 * The phone while the room arrives. The parent keeps the identity bar and owns
 * the socket and the local press feedback (`onPractice`); this is one native
 * button in the lobby and one instruction in an introduction. "Buzzer tested"
 * needs this player's own receipt, so it never claims more than the server saw.
 */
export function ArrivalPhone({ state, arrival, playerId, connected, feedback, pulseNow, onPractice }: {
  state: State
  arrival: ArrivalPresentation
  playerId: PlayerId | null
  connected: boolean
  feedback: PracticeFeedback
  pulseNow: number
  onPractice: () => void
}) {
  if (arrival.kind === 'introduction') {
    return (
      <div class="arrival-phone" data-review-id="phone:arrival-introduction">
        <p class="eyebrow">First block</p>
        <h2 class="arrival-phone__title">{arrival.title}</h2>
        <p class="arrival-phone__text">{arrival.phone}</p>
        <p class="arrival-phone__wait chip">Waiting for the host</p>
      </div>
    )
  }

  const joined = !!playerId && state.players.some((p) => p.id === playerId)
  const can = joined && connected
  const lobbyId = practiceLobbyId(state)
  const confirmed = !!playerId && activePracticePlayers(feedback, lobbyId, pulseNow).includes(playerId)
  const tested = !!playerId && state.arrival?.kind === 'lobby' && state.arrival.testedPlayerIds.includes(playerId)
  const why = !joined ? 'Join the game to test your buzzer' : !connected ? 'Disconnected. Reconnecting' : null

  return (
    <div class="arrival-phone" data-review-id="phone:arrival-lobby">
      {/* Pointer down for the same snap as the real buzzer; click only for keyboard activation. */}
      <button
        data-review-id="phone:practice"
        class={confirmed ? 'buzzer arrival-phone__test is-first' : 'buzzer arrival-phone__test is-waiting'}
        disabled={!can}
        onPointerDown={() => can && onPractice()}
        onClick={(e) => { if (can && e.detail === 0) onPractice() }}
      >
        {confirmed ? 'Buzzer tested' : 'Test buzzer'}
        <span class="buzzer__sub">{why ?? 'Practice only · no points'}</span>
      </button>
      <p class={tested ? 'arrival-phone__status chip chip--won' : 'arrival-phone__status chip'} aria-live="polite">
        {tested ? 'Buzzer tested' : 'Not tested yet'}
      </p>
    </div>
  )
}
