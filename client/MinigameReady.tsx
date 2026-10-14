import type { ClientMsg, PlayerId, State } from '../shared/protocol.ts'

/**
 * The one Ready control every minigame phone shares while the match waits in
 * its lobby. Mounted once by the player surface beside whichever game screen
 * is up, so no game branches on it. Poker is run by the host and has none.
 * Shown only under autoplay, which starts the match when every connected player has tapped it;
 * without autoplay the host starts the match. While it shows, the surface above it gives up its
 * bottom edge (`.minigame-stage--ready`), so it never covers a game control.
 */
export function readyShown(state: State, playerId: PlayerId | null): boolean {
  const session = state.minigame
  return state.autoplay.on && !!session && session.phase === 'ready' && session.id !== 'poker' && !!playerId
}

export function MinigameReady({ state, playerId, send }: {
  state: State
  playerId: PlayerId | null
  send: (message: ClientMsg) => void
}) {
  const session = state.minigame
  if (!session || !playerId || !readyShown(state, playerId)) return null
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
