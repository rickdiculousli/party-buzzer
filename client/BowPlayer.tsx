import { useRef, useState } from 'preact/hooks'
import type { BowInputAck, ClientMsg, MinigameFrame, State } from '../shared/protocol.ts'
import { aimFromDrag, canBowShoot, nextBowSequence } from './bow-control.ts'

export function BowPlayer({ state, frame, now, send, ack }: {
  state: State
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: BowInputAck | null
}) {
  const session = state.minigame!
  const mine = frame?.matchId === session.matchId && frame.role === 'player' ? frame : null
  const spectator = frame?.matchId === session.matchId && frame.role === 'spectator'
  const start = useRef<{ x: number; y: number } | null>(null)
  const [aim, setAim] = useState({ angle: 0, tension: 0 })

  const update = (event: PointerEvent) => {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = Math.max(0, event.clientY - start.current.y)
    const next = aimFromDrag(dx, dy)
    setAim(next)
    send({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: { kind: 'aim', ...next } })
  }

  const release = (event: PointerEvent) => {
    if (!start.current) return
    update(event)
    start.current = null
    send({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: { kind: 'release', at: now() } })
    navigator.vibrate?.(45)
    setAim({ angle: 0, tension: 0 })
  }

  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const reloading = !!mine && now() < mine.player.reloadUntilMs
  const landing = session.phase === 'playing' && !!session.endsAt && now() >= session.endsAt
  const active = canBowShoot(session.phase, session.endsAt, now(), !!mine, reloading)

  return (
    <main class="bow-phone">
      <header class="bow-phone__instructions">
        <strong>{session.phase === 'countdown' ? `Starts in ${countdown}` : landing ? 'Finishing arrows' : session.phase === 'playing' ? 'Drag down and release' : session.phase === 'results' ? 'Match complete' : 'Waiting for host'}</strong>
        <span>{spectator ? 'Spectating until the next match' : reloading ? 'Reloading…' : `${mine?.player.score ?? 0} points`}</span>
        {ack?.matchId === session.matchId && <small>{ack.status === 'accepted' ? 'Shot sent' : 'Shot refused'}</small>}
      </header>
      <div
        class={active ? 'bow-control is-active' : 'bow-control'}
        onPointerDown={(event) => {
          if (!active) return
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          start.current = { x: event.clientX, y: event.clientY }
          setAim({ angle: 0, tension: 0 })
        }}
        onPointerMove={update}
        onPointerUp={release}
        onPointerCancel={() => { start.current = null; setAim({ angle: 0, tension: 0 }) }}
      >
        <svg viewBox="0 0 400 600" aria-label="Bow control">
          <path d="M 95 255 Q 200 150 305 255" class="bow-control__body" />
          <path d={`M 95 255 L ${200 + aim.angle * 70} ${255 + aim.tension * 190} L 305 255`} class="bow-control__string" />
          <line x1={200 + aim.angle * 70} y1={255 + aim.tension * 190} x2={200 + aim.angle * 95} y2={120} class="bow-control__arrow" />
          <circle cx={200 + aim.angle * 70} cy={255 + aim.tension * 190} r="15" class="bow-control__touch-outer" />
          <circle cx={200 + aim.angle * 70} cy={255 + aim.tension * 190} r="7" class="bow-control__touch-inner" />
        </svg>
      </div>
    </main>
  )
}
