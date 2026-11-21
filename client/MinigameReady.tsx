import type { ClientMsg, PlayerId, State } from '../shared/protocol.ts'

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
