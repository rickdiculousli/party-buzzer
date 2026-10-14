import type { ClientMsg, PlayerId, State } from '../shared/protocol.ts'

/**
 * The one Ready control every minigame phone shares while the match waits in
 * its lobby. Mounted once by the player surface beside whichever game screen
 * is up, so no game branches on it. Poker is run by the host and has none.
 * Autoplay starts the match when every connected player has tapped it.
 */
export function MinigameReady({ state, playerId, send }: {
  state: State
  playerId: PlayerId | null
  send: (message: ClientMsg) => void
}) {
  const session = state.minigame
  if (!session || session.phase !== 'ready' || session.id === 'poker' || !playerId) return null
  const on = session.lobby?.ready?.includes(playerId) ?? false
  return (
    <div class="minigame-ready" data-review-id="phone:ready">
      <button
        class={on ? 'btn btn--major minigame-ready__btn is-on' : 'btn btn--major btn--primary minigame-ready__btn'}
        aria-pressed={on}
        onClick={() => send({ t: 'minigameLobby', change: { do: 'ready', on: !on } })}
      >
        {on ? 'Ready · tap to undo' : 'Ready'}
      </button>
    </div>
  )
}
