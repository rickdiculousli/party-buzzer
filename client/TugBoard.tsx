import { useEffect, useRef, useState } from 'preact/hooks'
import type { MinigameFrame, TugSide } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { play } from './sound.ts'
import { NO_CROSSING, easeToward, follow, swing, watchCrossing, type Crossing, type Rope } from './tug.ts'
import { playerName } from './ui.ts'

type BoardFrame = Extract<MinigameFrame, { role: 'board'; id: 'tug' }>

const CENTRE = 800
/** Distance the flag travels from the centre to a mark, in field units. */
const MARK_DISTANCE = 560
const ROPE_Y = 250
/** Both sides straining at once: the flag shakes. */
const TENSE = 0.6
/** At the win the rope is carried this far past the mark before it settles. */
const CARRY = 0.05
/** Effort meters ease over this long, so they read as strain rather than strobe. */
const METER_MS = 300

type Drawn = { rope: Rope; effort: [number, number] }

/** The drawn rope and meters, eased every animation frame toward the latest server frame. */
function useDrawn(board: BoardFrame | null, onSwing: () => void): Drawn {
  const [drawn, setDrawn] = useState<Drawn>({ rope: { x: 0, v: 0 }, effort: [0, 0] })
  const live = useRef(drawn)
  const target = useRef<BoardFrame | null>(board)
  target.current = board
  const crossing = useRef<Crossing>(NO_CROSSING)
  const swung = useRef(onSwing)
  swung.current = onSwing
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = t - last
      last = t
      const frame = target.current
      const won = frame?.winner === 0 || frame?.winner === 1
      const aim = won ? (frame!.winner === 1 ? 1 + CARRY : -1 - CARRY) : frame?.flag ?? 0
      const rope = follow(live.current.rope, aim, dt)
      const effort = [0, 1].map((s) => easeToward(live.current.effort[s], frame?.effort[s] ?? 0, dt, METER_MS)) as [number, number]
      if (frame && frame.winner === undefined) {
        const seen = watchCrossing(crossing.current, rope.x, t)
        crossing.current = seen.next
        if (seen.crossed) swung.current()
      }
      live.current = { rope, effort }
      setDrawn(live.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return drawn
}

/** Fires on a change of `value` after mount, never for the value the board mounted on. */
function useOnChange<T>(value: T, fire: (value: T) => void) {
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current === value) return
    seen.current = value
    fire(value)
  }, [value])
}

function SideCard({ side, effort, state }: { side?: TugSide; effort: number; state: MinigameBoardProps['state'] }) {
  return (
    <section class="tug-side" style={{ color: side?.color ?? 'var(--dim)' }}>
      <strong class="tug-side__name">{side?.name ?? ' '}</strong>
      <p class="tug-side__members">{side?.members.map((id) => <span key={id}>{playerName(state, id)}</span>)}</p>
      <div class="tug-meter" aria-label="Pull">
        <div class="tug-meter__fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, effort))})` }} />
      </div>
      <span class="tug-meter__label">Pull</span>
    </section>
  )
}

export function TugBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const board = matchFrame(frame, 'tug', 'board', session.matchId)
  // The sides outlive the last frame, so the results can name the winners' side.
  const sidesSeen = useRef<BoardFrame['sides'] | null>(null)
  if (board) sidesSeen.current = board.sides
  const sides = board?.sides ?? sidesSeen.current
  const { rope, effort } = useDrawn(board, () => play('stamp', { rateScale: 1.3 }))
  const winner = board?.winner

  // Three cues, on transitions only, so a board reloaded mid-match stays quiet.
  useOnChange(session.phase, (phase) => {
    if (phase === 'playing') play('stamp')
    if (phase === 'results' && session.results?.some((r) => r.points > 0)) play('award')
  })
  useOnChange(winner, (w) => { if (w === 0 || w === 1) play('leader') })

  if (session.phase === 'results') {
    const results = session.results ?? []
    const won = results.filter((r) => r.points > 0)
    const rest = results.filter((r) => r.points <= 0)
    const winSide = won.length ? sides?.find((s) => s.members.includes(won[0].playerId)) : undefined
    const row = (r: (typeof results)[number]) => (
      <li key={r.playerId}>
        <span>{playerName(state, r.playerId)}</span>
        {r.points > 0 && <strong class="tug-results__points">+{r.points}</strong>}
      </li>
    )
    return (
      <main class="tug-results">
        <p class="eyebrow">Tug of war</p>
        <h2 class="tug-results__verdict fx-rise" style={{ color: winSide?.color }}>
          {won.length === 0 ? 'Draw' : winSide ? `${winSide.name} wins` : 'Winners'}
        </h2>
        {won.length > 0 && <ol class="tug-results__list">{won.map(row)}</ol>}
        {rest.length > 0 && <ol class="tug-results__list tug-results__rest">{rest.map(row)}</ol>}
      </main>
    )
  }

  const decided = winner !== undefined
  const remaining = Math.max(0, Math.ceil(((board?.endsAt ?? session.endsAt ?? 0) - now()) / 1000))
  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const flagX = CENTRE + rope.x * MARK_DISTANCE
  const tense = !decided && Math.min(effort[0], effort[1]) > TENSE
  const verdict = !decided || !sides ? null : winner === null ? 'Draw' : `${sides[winner].name} wins`

  return (
    <main class={verdict ? 'tug-board is-decided' : 'tug-board'}>
      <header class="tug-board__header">
        <strong class="tug-board__title">Tug of war</strong>
        {session.phase === 'playing' && !decided && <span class={remaining <= 5 ? 'tug-clock is-low' : 'tug-clock'}>{remaining}</span>}
      </header>
      <svg class="tug-field" viewBox="0 0 1600 500" aria-label="Tug of war rope">
        <line x1={CENTRE} y1="60" x2={CENTRE} y2="440" class="tug-field__centre" />
        {[0, 1].map((s) => {
          const x = CENTRE + (s === 0 ? -MARK_DISTANCE : MARK_DISTANCE)
          return (
            <g key={s} style={{ color: sides?.[s].color ?? 'var(--dim)' }}>
              <line x1={x} y1="60" x2={x} y2="440" class="tug-field__mark" />
            </g>
          )
        })}
        <line x1="-800" y1={ROPE_Y} x2="2400" y2={ROPE_Y} class="tug-field__rope" />
        <line x1="-800" y1={ROPE_Y} x2="2400" y2={ROPE_Y} class="tug-field__twist" style={{ strokeDashoffset: -(rope.x * MARK_DISTANCE) }} />
        <g transform={`translate(${flagX} ${ROPE_Y})`}>
          <g transform={`rotate(${swing(rope.v)})`}>
            <g class={tense ? 'tug-flag is-tense' : 'tug-flag'}>
              <path d="M -26 8 L 26 8 L 18 150 L 0 132 L -18 150 Z" class="tug-flag__ribbon" />
            </g>
          </g>
          <circle r="15" class="tug-flag__knot" />
        </g>
        {session.phase === 'countdown' && countdown > 0 && (
          <text key={countdown} x={CENTRE} y="420" class="tug-field__count fx-pop">{countdown}</text>
        )}
      </svg>
      {verdict && (
        <div class="tug-board__verdict">
          <h2 class="fx-tada" style={{ color: winner === 0 || winner === 1 ? sides![winner].color : undefined }}>{verdict}</h2>
        </div>
      )}
      <footer class="tug-board__sides">
        <SideCard side={sides?.[0]} effort={effort[0]} state={state} />
        <SideCard side={sides?.[1]} effort={effort[1]} state={state} />
      </footer>
    </main>
  )
}
