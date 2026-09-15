import { useRef, useState } from 'preact/hooks'
import type { MinigameInputAck, ClientMsg, MinigameFrame, State } from '../shared/protocol.ts'
import { aimDegrees, aimFromDrag, canBowShoot, nextBowSequence } from './bow-control.ts'

export function BowPlayer({ state, frame, now, send, ack }: {
  state: State
  frame: MinigameFrame | null
  now: () => number
  send: (message: ClientMsg) => void
  ack?: MinigameInputAck | null
}) {
  const session = state.minigame!
  const mine = frame?.matchId === session.matchId && frame.role === 'player' ? frame : null
  const spectator = frame?.matchId === session.matchId && frame.role === 'spectator'
  const start = useRef<{ x: number; y: number } | null>(null)
  const [aim, setAim] = useState({ angle: 0, tension: 0 })
  // The drawn bow rests at the last shot's direction and eases toward the live aim
  // as tension builds; the aim sent to the server is unaffected.
  const restAngle = useRef(0)
  // One pulse on reaching full draw. It re-arms only after tension drops below 95%,
  // and never pulses within 100ms of the last, so hovering at the edge stays quiet.
  const fullDrawArmed = useRef(true)
  const lastFullDrawPulse = useRef(0)

  const update = (event: PointerEvent) => {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = Math.max(0, event.clientY - start.current.y)
    const next = aimFromDrag(dx, dy)
    if (next.tension < 0.95) fullDrawArmed.current = true
    else if (next.tension >= 1 && fullDrawArmed.current && event.timeStamp - lastFullDrawPulse.current >= 100) {
      fullDrawArmed.current = false
      lastFullDrawPulse.current = event.timeStamp
      navigator.vibrate?.(10)
    }
    setAim(next)
    send({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: { kind: 'aim', ...next } })
    return next
  }

  const release = (event: PointerEvent) => {
    if (!start.current) return
    const shot = update(event)!
    start.current = null
    send({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: { kind: 'release', at: now() } })
    navigator.vibrate?.(45)
    restAngle.current = shot.angle
    setAim({ angle: shot.angle, tension: 0 })
  }

  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const reloading = !!mine && now() < mine.player.reloadUntilMs
  const landing = session.phase === 'playing' && !!session.endsAt && now() >= session.endsAt
  const active = canBowShoot(session.phase, session.endsAt, now(), !!mine, reloading)
  const nockY = 255 + aim.tension * 190
  const shownAngle = restAngle.current + (aim.angle - restAngle.current) * Math.min(1, aim.tension / 0.1)

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
        }}
        onPointerMove={update}
        onPointerUp={release}
        onPointerCancel={() => { start.current = null; setAim((last) => ({ angle: last.angle, tension: 0 })) }}
      >
        <svg viewBox="0 0 400 600" aria-label="Bow control">
          <g transform={`rotate(${aimDegrees(shownAngle)} 200 203)`}>
            <path d="M 95 255 Q 200 150 305 255" class="bow-control__body" />
            <path d={`M 95 255 L 200 ${nockY} L 305 255`} class="bow-control__string" />
            <line x1="200" y1={nockY} x2="200" y2="120" class="bow-control__arrow" />
            <circle cx="200" cy={nockY} r="15" class="bow-control__touch-outer" />
            <circle cx="200" cy={nockY} r="7" class="bow-control__touch-inner" />
          </g>
        </svg>
      </div>
    </main>
  )
}
