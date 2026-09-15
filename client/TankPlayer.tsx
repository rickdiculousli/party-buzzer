import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TankFrameWeapon, TankInput } from '../shared/protocol.ts'
import { nextBowSequence } from './bow-control.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { reloadProgress, wheelTurns } from './tank-control.ts'

type Part = 'hull' | 'turret'
const SPOKES = [0, 60, 120, 180, 240, 300]

function Wheel({ label, onTurn }: { label: string; onTurn: (turns: number) => void }) {
  const last = useRef<number | null>(null)
  const total = useRef(0)
  const [shown, setShown] = useState(0)
  const angleOf = (event: PointerEvent) => {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    return Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2))
  }
  return (
    <div
      class="tank-wheel"
      aria-label={label}
      onPointerDown={(event) => {
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        last.current = angleOf(event)
      }}
      onPointerMove={(event) => {
        if (last.current === null) return
        const next = angleOf(event)
        const turns = wheelTurns(last.current, next)
        last.current = next
        const before = total.current
        total.current += turns
        // A light tick every eighth of a turn.
        if (Math.floor(before * 8) !== Math.floor(total.current * 8)) navigator.vibrate?.(5)
        setShown(total.current)
        onTurn(turns)
      }}
      onPointerUp={() => { last.current = null }}
      onPointerCancel={() => { last.current = null }}
    >
      <svg viewBox="-100 -100 200 200">
        <g transform={`rotate(${shown * 360})`}>
          <circle r="80" class="tank-wheel__rim" />
          {SPOKES.map((deg) => (
            <line key={deg} x2={80 * Math.cos(deg * Math.PI / 180)} y2={80 * Math.sin(deg * Math.PI / 180)} class="tank-wheel__spoke" />
          ))}
          <circle r="14" class="tank-wheel__hub" />
          <circle cx="80" r="15" class="tank-wheel__knob" />
        </g>
      </svg>
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

  // Wheel turns accumulate and go out about 30 times a second.
  const pending = useRef<Record<Part, number>>({ hull: 0, turret: 0 })
  useEffect(() => {
    const id = setInterval(() => {
      for (const part of ['hull', 'turret'] as const) {
        const turns = pending.current[part]
        if (!turns) continue
        pending.current[part] = 0
        input(solo ? { kind: 'wheel', turns, part } : { kind: 'wheel', turns })
      }
    }, 33)
    return () => clearInterval(id)
  }, [session.matchId, solo])

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

  return (
    <main class="tank-phone">
      <header class="bow-phone__instructions">
        <strong>{status}</strong>
        <span>{crew ? `${role}${partner && !solo ? ` with ${partner}` : ''} · ${mine?.tank.hp ?? 100} HP · ${mine?.tank.score ?? 0} pts` : 'Spectating until the next match'}</span>
      </header>
      <div class={mine && session.phase === 'playing' ? 'tank-phone__roles is-active' : 'tank-phone__roles'}>
        {driver && (
          <section class="tank-role">
            <Wheel label="Hull wheel" onTurn={(turns) => { pending.current.hull += turns }} />
            <div class="tank-buttons">
              <HoldButton class="tank-btn" onHold={(down) => drive('back', down)}><span class="tank-btn__text">Back</span></HoldButton>
              <HoldButton class="tank-btn" onHold={(down) => drive('forward', down)}><span class="tank-btn__text">Forward</span></HoldButton>
            </div>
          </section>
        )}
        {gunner && (
          <section class="tank-role">
            <Wheel label="Turret wheel" onTurn={(turns) => { pending.current.turret += turns }} />
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
