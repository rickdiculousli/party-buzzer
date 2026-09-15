import { useRef } from 'preact/hooks'
import type { MinigameFrame } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { coverPath, nearestAngleDegrees } from './tank-control.ts'
import { colorForPlayer } from './ui.ts'

type TankBoardFrame = Extract<MinigameFrame, { role: 'board'; id: 'tank' }>

const BLAST_MS = 250
const AIM_DASHES = [0, 1, 2, 3, 4, 5, 6, 7]

export function TankBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const board = frame?.role === 'board' && frame.id === 'tank' && frame.matchId === session.matchId ? frame : null
  const cells = useRef<Uint8Array | null>(null)
  const path = useRef('')
  const blasts = useRef<{ x: number; y: number; radius: number; at: number }[]>([])
  const seen = useRef<TankBoardFrame | null>(null)
  const angles = useRef(new Map<string, { hull: number; turret: number }>())
  const angleMatch = useRef('')

  if (angleMatch.current !== session.matchId) {
    angleMatch.current = session.matchId
    angles.current.clear()
  }

  // ponytail: frames coalesced by a render lose their cleared cells until the next full grid (≤1 s); apply frames in the socket handler if walls visibly lag.
  if (board && seen.current !== board) {
    seen.current = board
    if (board.cover) cells.current = Uint8Array.from(board.cover, (digit) => digit === '1' ? 1 : 0)
    if (cells.current && (board.cover || board.coverChanged.length > 0)) {
      for (const index of board.coverChanged) cells.current[index] = 0
      path.current = coverPath(cells.current)
    }
    for (const blast of board.blasts) blasts.current.push({ ...blast.position, radius: blast.radius, at: now() })
  }
  blasts.current = blasts.current.filter((blast) => now() - blast.at < BLAST_MS)

  const nameOf = (id: string) => state.players.find((player) => player.id === id)?.name ?? '?'
  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0

  if (session.phase === 'results') return (
    <main class="bow-results">
      <p class="eyebrow">Tank results</p>
      <ol class="bow-results__list">
        {session.results?.map((result, index) => (
          <li key={result.playerId}>
            <span>{index + 1}. {nameOf(result.playerId)}</span>
            <strong>{result.points}</strong>
          </li>
        ))}
      </ol>
    </main>
  )

  return (
    <main class="bow-board">
      <header class="bow-board__header">
        <strong>Tank battle</strong>
        <span>{session.phase === 'ready' ? 'Ready' : session.phase === 'countdown' ? `Starts in ${countdown}` : `${remaining}s`}</span>
      </header>
      <svg class="bow-field" viewBox="0 0 1600 900" aria-label="Shared tank field">
        <rect width="1600" height="900" class="bow-field__ground" />
        <path d={path.current} class="tank-field__cover" />
        {board?.tanks.map((tank) => {
          const { x, y } = tank.position
          const prior = angles.current.get(tank.id)
          const hull = nearestAngleDegrees(prior?.hull, tank.hull)
          const turret = nearestAngleDegrees(prior?.turret, tank.turret)
          angles.current.set(tank.id, { hull, turret })
          const names = tank.crew.driver === tank.crew.gunner
            ? nameOf(tank.crew.driver)
            : `${nameOf(tank.crew.driver)} & ${nameOf(tank.crew.gunner)}`
          return (
            <g key={tank.id} class="tank-field__position" transform={`translate(${x} ${y})`} style={{ color: colorForPlayer(state, tank.crew.driver) }} opacity={tank.dead ? 0.25 : tank.invulnerable ? 0.6 : 1}>
              <g class="tank-field__rotation" transform={`rotate(${hull})`}>
                <rect x="-25" y="-17" width="50" height="34" rx="4" class="tank-field__hull" />
                <g class="tank-field__rotation" transform={`rotate(${turret})`}>
                  {!tank.dead && AIM_DASHES.map((i) => (
                    <line key={i} x1={34 + i * 25} x2={49 + i * 25} class="tank-field__aim" opacity={0.7 * (1 - i / AIM_DASHES.length)} />
                  ))}
                  <line x2="30" class="tank-field__barrel" />
                  <circle r="10" class="tank-field__turret" />
                </g>
              </g>
              <rect x="-25" y="-34" width="50" height="5" class="tank-field__hp-back" />
              <rect x="-25" y="-34" width={50 * tank.hp / 100} height="5" class="tank-field__hp" />
              <text y="44" class="bow-field__name">{names} · {tank.score}</text>
            </g>
          )
        })}
        {board?.projectiles.map((shot) => (
          <circle key={shot.id} transform={`translate(${shot.position.x} ${shot.position.y})`} r={shot.weapon === 'cannon' ? 6 : 3} class="tank-field__shot tank-field__position" />
        ))}
        {blasts.current.map((blast, index) => (
          <circle key={index} cx={blast.x} cy={blast.y} r={blast.radius} class="tank-field__blast" opacity={1 - (now() - blast.at) / BLAST_MS} />
        ))}
      </svg>
    </main>
  )
}
