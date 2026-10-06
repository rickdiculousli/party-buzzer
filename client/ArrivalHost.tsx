import './arrival-host.css'
import { arrivalBlocksPlay } from '../shared/arrival.ts'
import { refuses } from '../shared/legality.ts'
import type { HostAction, State } from '../shared/protocol.ts'
import { REFUSAL_TEXT } from './ui.ts'

/**
 * Why the host's Read control must be dead right now, or null. The parent
 * disables Read with this text; the server enforces the same rule.
 */
export function readBlockedReason(state: State): string | null {
  return arrivalBlocksPlay(state) ? REFUSAL_TEXT['introduction-active'] : null
}

/**
 * The Play desk's arrival block: Open lobby in a quiet room, the tested count
 * and Close lobby while one is open, Continue while an introduction is up.
 * Informational only; nothing here gates play on readiness.
 */
export function ArrivalHost({ state, act }: { state: State; act: (action: HostAction) => void }) {
  const arrival = state.arrival

  if (arrival?.kind === 'introduction') {
    return (
      <section class="arrival-host" data-review-id="host:arrival-introduction">
        <p class="eyebrow">First block</p>
        <div class="arrival-host__row">
          <button class="btn btn--primary" onClick={() => act({ a: 'closeArrival', arrivalId: arrival.id })}>Continue</button>
          <p class="arrival-host__note">Reading and arming wait until you continue.</p>
        </div>
      </section>
    )
  }

  if (arrival?.kind === 'lobby') {
    const connected = state.players.filter((p) => p.connected)
    const tested = connected.filter((p) => arrival.testedPlayerIds.includes(p.id)).length
    return (
      <section class="arrival-host" data-review-id="host:arrival-lobby">
        <p class="eyebrow">Lobby</p>
        <div class="arrival-host__row">
          <button class="btn" onClick={() => act({ a: 'closeArrival', arrivalId: arrival.id })}>Close lobby</button>
          <p class="arrival-host__note readout">{tested} of {connected.length} tested</p>
        </div>
      </section>
    )
  }

  const refusal = refuses(state, { a: 'openLobby' })
  return (
    <section class="arrival-host" data-review-id="host:arrival-open">
      <p class="eyebrow">Lobby</p>
      <div class="arrival-host__row">
        <button class="btn" disabled={!!refusal} aria-describedby={refusal ? 'arrival-host-why' : undefined} onClick={() => act({ a: 'openLobby' })}>
          Open lobby
        </button>
        <p class="arrival-host__note" id="arrival-host-why">{refusal ? REFUSAL_TEXT[refusal] : 'Players test their buzzers, no points.'}</p>
      </div>
    </section>
  )
}
