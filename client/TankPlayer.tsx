import type { ComponentChildren } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { TankFrameWeapon, TankInput } from '../shared/protocol.ts'
import { nextBowSequence } from './bow-control.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { useSideways } from './useSideways.ts'
import { reloadProgress, wheelTurns, type TankViewRotation } from './tank-control.ts'

const CRANK_SPOKES = [0, 60, 120, 180, 240, 300]

function Crank({ label, viewRotation, onAim }: { label: string; viewRotation: TankViewRotation; onAim: (angle: number) => void }) {
  const last = useRef<number | null>(null)
  const unwrapped = useRef(0)
  const [shown, setShown] = useState(0)
  const angleOf = (event: PointerEvent) => {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    const viewportAngle = Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2))
    return viewportAngle - viewRotation * Math.PI / 180
  }
  return (
    <div
      class="tank-wheel"
      aria-label={label}
      onPointerDown={(event) => {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        const angle = angleOf(event)
        last.current = angle
        unwrapped.current = angle
        setShown(angle)
        onAim(angle)
      }}
      onPointerMove={(event) => {
        if (last.current === null) return
        const next = angleOf(event)
        const before = unwrapped.current
        unwrapped.current += wheelTurns(last.current, next) * Math.PI * 2
        last.current = next
        if (Math.floor(before / (Math.PI / 2)) !== Math.floor(unwrapped.current / (Math.PI / 2))) navigator.vibrate?.(8)
        setShown(next)
        onAim(next)
      }}
      onPointerUp={() => { last.current = null }}
      onPointerCancel={() => { last.current = null }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg viewBox="-105 -105 210 210" aria-hidden="true">
        <g transform={`rotate(${shown * 180 / Math.PI})`}>
          <circle r="80" class="tank-wheel__rim" />
          {CRANK_SPOKES.map((deg) => (
            <line key={deg} x2={80 * Math.cos(deg * Math.PI / 180)} y2={80 * Math.sin(deg * Math.PI / 180)} class="tank-wheel__spoke" />
          ))}
          <circle r="14" class="tank-wheel__hub" />
          <circle cx="80" r="15" class="tank-wheel__knob" />
        </g>
      </svg>
      <span>{label}</span>
    </div>
  )
}

function HoldButton({ class: className, onHold, children }: {
  class: string
  onHold: (down: boolean) => void
  children: ComponentChildren
}) {
  return (
    <button
      class={className}
      onPointerDown={(event) => {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        onHold(true)
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  )
}

function WeaponButton({ name, weapon, now, onHold }: {
  name: string
  weapon: TankFrameWeapon | undefined
  now: number
  onHold: (down: boolean) => void
}) {
  const progress = weapon ? reloadProgress(weapon, now) : 1
  const empty = !weapon || weapon.clip === 0
  return (
    <HoldButton class={empty ? 'tank-btn is-empty' : 'tank-btn'} onHold={onHold}>
      {progress < 1 && <span class="tank-btn__reload" style={{ width: `${progress * 100}%` }} />}
      <span class="tank-btn__text">{name}</span>
      <span class="tank-btn__text">{weapon ? `${weapon.clip}/${weapon.size}` : '–'}</span>
    </HoldButton>
  )
}

export function TankPlayer({ state, playerId, frame, now, send }: MinigamePlayerProps) {
  const session = state.minigame!
  const mine = frame?.matchId === session.matchId && frame.role === 'player' && frame.id === 'tank' ? frame : null
  const crew = session.crews?.find((c) => c.driver === playerId || c.gunner === playerId)
  const driver = !!crew && crew.driver === playerId
  const gunner = !!crew && crew.gunner === playerId
  const solo = driver && gunner
  const partner = crew && state.players.find((p) => p.id === (driver ? crew.gunner : crew.driver))?.name

  const sendRef = useRef(send)
  sendRef.current = send
  const input = (value: TankInput) =>
    sendRef.current({ t: 'minigameInput', matchId: session.matchId, seq: nextBowSequence(localStorage), input: value })

  const viewRotation = useSideways()
  const held = useRef({ forward: false, back: false })
  const drive = (key: 'forward' | 'back', down: boolean) => {
    held.current[key] = down
    input({ kind: 'drive', dir: held.current.forward ? 1 : held.current.back ? -1 : 0 })
  }
  const trigger = (weapon: 'gun' | 'cannon', down: boolean) => input({ kind: 'trigger', weapon, down, at: now() })

  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const respawn = mine?.tank.respawnAt ? Math.max(0, Math.ceil((mine.tank.respawnAt - now()) / 1000)) : null
  const role = solo ? 'Solo crew' : driver ? 'Driver' : gunner ? 'Gunner' : 'Spectating'
  const status = session.phase === 'countdown' ? `Starts in ${countdown}`
    : session.phase === 'results' ? 'Match complete'
    : session.phase === 'ready' ? 'Waiting for host'
    : respawn !== null ? `Respawning in ${respawn}`
    : role
  const controlMessage = driver ? 'Point the dial where you want to go · hold Forward or Back to drive'
    : gunner ? 'Point the dial where you want to fire' : 'Watching this match'
  const rotationClass = viewRotation === 90 ? ' tank-phone--rotate-cw'
    : viewRotation === -90 ? ' tank-phone--rotate-ccw'
    : viewRotation === 180 ? ' tank-phone--rotate-half'
    : ''

  return (
    <main class={`tank-phone${rotationClass}`}>
      <header class="bow-phone__instructions">
        <strong>{status}</strong>
        <span>{crew ? `${role}${partner && !solo ? ` with ${partner}` : ''} · ${mine?.tank.hp ?? 100} HP · ${mine?.tank.score ?? 0} pts` : 'Spectating until the next match'}</span>
        <span>{controlMessage}</span>
        {viewRotation !== 0 && <span class="tank-orientation-hint">Turn sideways · speaker end left</span>}
      </header>
      <div class={mine && session.phase === 'playing' ? 'tank-phone__roles is-active' : 'tank-phone__roles'}>
        {driver && (
          <section class="tank-role tank-role--driver">
            <Crank label="Point where you want to go" viewRotation={viewRotation} onAim={(angle) => input({ kind: 'hullAim', angle })} />
            <div class="tank-buttons">
              <HoldButton class="tank-btn" onHold={(down) => drive('forward', down)}><span class="tank-btn__text">Forward</span></HoldButton>
              <HoldButton class="tank-btn" onHold={(down) => drive('back', down)}><span class="tank-btn__text">Back</span></HoldButton>
            </div>
          </section>
        )}
        {gunner && (
          <section class="tank-role tank-role--gunner">
            {solo
              ? <div class="tank-turret-lock"><strong>Turret forward</strong><span>Aim by steering the hull</span></div>
              : <Crank label="Point where you want to fire" viewRotation={viewRotation} onAim={(angle) => input({ kind: 'turretAim', angle })} />}
            <div class="tank-buttons">
              <WeaponButton name="Gun" weapon={mine?.tank.gun} now={now()} onHold={(down) => trigger('gun', down)} />
              <WeaponButton name="Cannon" weapon={mine?.tank.cannon} now={now()} onHold={(down) => trigger('cannon', down)} />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
