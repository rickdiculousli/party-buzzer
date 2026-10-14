import { useRef } from 'preact/hooks'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'

export function TugPlayer({ state, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const mine = matchFrame(frame, 'tug', 'player', session.matchId)
  const spectator = frame?.matchId === session.matchId && frame.role === 'spectator'
  const seq = useRef(Date.now())
  const handle = useRef<HTMLDivElement>(null)

  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const stopped = session.phase === 'results' || mine?.winner !== undefined
  const pulling = session.phase === 'playing' && !!mine && !stopped
  const side = mine ? mine.sides[mine.side] : null

  const pull = (event: PointerEvent) => {
    event.preventDefault()
    if (!pulling) return
    send({ t: 'minigameInput', matchId: session.matchId, seq: seq.current++, input: { kind: 'pull' } })
    navigator.vibrate?.(30)
    // Restart the squash on the whole handle for every finger.
    const el = handle.current
    if (el) {
      el.classList.remove('fx-squash')
      void el.offsetWidth
      el.classList.add('fx-squash')
    }
  }

  const winner = mine?.winner
  const title = session.phase === 'countdown' ? `Starts in ${countdown}`
    : winner === null ? 'Draw'
    : winner !== undefined && mine ? `${mine.sides[winner].name} wins` + (winner === mine.side ? ` · +${session.options.value}` : '')
    : stopped ? 'Rope stopped'
    : session.phase === 'playing' ? 'Tap to pull'
    : 'Waiting for host'
  const flag = mine?.flag ?? 0

  return (
    <main class="tug-phone">
      <header class="bow-phone__instructions">
        <strong>{title}</strong>
        <span>{spectator ? 'Spectating until the next match' : side ? `You're on ${side.name}` : ' '}</span>
      </header>
      <div ref={handle} class="tug-press">
        <div
          class={pulling ? 'tug-handle is-active' : 'tug-handle'}
          style={{ '--tug-side': side?.color ?? 'var(--dim)' }}
          onPointerDown={pull}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span class="tug-handle__grip">{pulling ? 'PULL' : ''}</span>
        </div>
      </div>
      {mine && (
        <div
          class="tug-mini"
          style={{ '--tug-left': mine.sides[0].color, '--tug-right': mine.sides[1].color }}
          aria-label="Where the flag is"
        >
          <span class="tug-mini__flag" style={{ left: `${(flag + 1) * 50}%` }} />
        </div>
      )}
    </main>
  )
}
