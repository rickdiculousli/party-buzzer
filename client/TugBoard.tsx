import { useEffect, useRef, useState } from 'preact/hooks'
import type { MinigameFrame } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { play } from './sound.ts'
import { NO_CROSSING, easeToward, watchCrossing, type Crossing } from './tug.ts'
import { playerName } from './ui.ts'

type BoardFrame = Extract<MinigameFrame, { role: 'board'; id: 'tug' }>

const CENTRE = 800
/** Distance the flag travels from the centre to a mark, in field units. */
const MARK_DISTANCE = 560
const ROPE_Y = 330
const TENSE = 0.6

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div class="tug-meter" style={{ color }}>
      <div class="tug-meter__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function TugBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const board = matchFrame(frame, 'tug', 'board', session.matchId)
  const target = board?.flag ?? 0
  const [drawn, setDrawn] = useState(0)
  const drawnRef = useRef(0)
  const targetRef = useRef(target)
  targetRef.current = target
  const crossing = useRef<Crossing>(NO_CROSSING)

  // Frames arrive about every 50 ms; the drawn flag eases toward the latest one.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const next = easeToward(drawnRef.current, targetRef.current, t - last)
      last = t
      if (Math.abs(next - drawnRef.current) > 1e-4) {
        drawnRef.current = next
        setDrawn(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Cues: the board is the only surface that plays them.
  useEffect(() => {
    if (session.phase === 'playing') play('stamp')
  }, [session.phase === 'playing'])
  useEffect(() => {
    if (session.phase !== 'playing' || !board || board.winner !== undefined) return
    const { next, crossed } = watchCrossing(crossing.current, board.flag, performance.now())
    crossing.current = next
    if (crossed) play('leader')
  }, [board?.flag])
  const winner = board?.winner
  useEffect(() => {
    if (winner === 0 || winner === 1) play('award')
  }, [winner])

  const remaining = session.endsAt ? Math.max(0, Math.ceil((session.endsAt - now()) / 1000)) : session.options.durationSec
  const countdown = session.startsAt ? Math.max(0, Math.ceil((session.startsAt - now()) / 1000)) : 0
  const sides = board?.sides

  if (session.phase === 'results') {
    const results = session.results ?? []
    const won = results.filter((r) => r.points > 0)
    const rest = results.filter((r) => r.points <= 0)
    const row = (r: (typeof results)[number]) => (
      <li key={r.playerId}>
        <span>{playerName(state, r.playerId)}</span>
        <strong>{r.points > 0 ? `+${r.points}` : r.points}</strong>
      </li>
    )
    const sideOf = (id: string) => sides?.find((s) => s.members.includes(id))
    const winSide = won.length ? sideOf(won[0].playerId) : undefined
    return (
      <main class="bow-results tug-results">
        <p class="eyebrow">Tug of war results</p>
        {won.length > 0 ? (
          <>
            <h2 class="tug-results__verdict" style={{ color: winSide?.color }}>{winSide ? `${winSide.name} won` : 'Winners'}</h2>
            <ol class="bow-results__list">{won.map(row)}</ol>
          </>
        ) : <h2 class="tug-results__verdict">Draw</h2>}
        {rest.length > 0 && <ol class="bow-results__list tug-results__rest">{rest.map(row)}</ol>}
      </main>
    )
  }

  const flagX = CENTRE + drawn * MARK_DISTANCE
  const effort = board?.effort ?? [0, 0]
  const tense = winner === undefined && Math.max(effort[0], effort[1]) > TENSE
  const verdict = winner === undefined || !sides ? null : winner === null ? 'Draw' : `${sides[winner].name} wins`
  const winners = winner === 0 || winner === 1 ? sides![winner].members : []

  return (
    <main class="tug-board">
      <header class="bow-board__header">
        <strong>Tug of war</strong>
        <span>{session.phase === 'ready' ? 'Ready' : session.phase === 'countdown' ? `Starts in ${countdown}` : `${remaining}s`}</span>
      </header>
      <svg class="tug-field" viewBox="0 0 1600 560" aria-label="Tug of war rope">
        <line x1={CENTRE} y1="90" x2={CENTRE} y2="470" class="tug-field__centre" />
        {[0, 1].map((s) => {
          const x = CENTRE + (s === 0 ? -MARK_DISTANCE : MARK_DISTANCE)
          return (
            <g key={s} style={{ color: sides?.[s].color ?? 'var(--dim)' }}>
              <line x1={x} y1="90" x2={x} y2="470" class="tug-field__mark" />
              <text x={x} y="76" class="tug-field__mark-label">{sides?.[s].name ?? ''}</text>
            </g>
          )
        })}
        <line x1="0" y1={ROPE_Y} x2="1600" y2={ROPE_Y} class="tug-field__rope" style={{ strokeDashoffset: -(drawn * MARK_DISTANCE) }} />
        <g transform={`translate(${flagX} ${ROPE_Y})`}>
          <g class={tense ? 'tug-flag is-tense' : 'tug-flag'}>
            <line x1="0" y1="-24" x2="0" y2="110" class="tug-flag__pole" />
            <path d="M 0 40 L 90 75 L 0 110 Z" class="tug-flag__cloth" />
            <circle r="16" class="tug-flag__knot" />
          </g>
        </g>
      </svg>
      {verdict && (
        <div class="tug-board__verdict">
          <h2 class="fx-tada" style={{ color: winner === 0 || winner === 1 ? sides![winner].color : undefined }}>{verdict}</h2>
          {winners.length > 0 && <p>{winners.map((id) => playerName(state, id)).join(' · ')}</p>}
        </div>
      )}
      <footer class="tug-board__sides">
        {[0, 1].map((s) => (
          <section key={s} class="tug-side" style={{ color: sides?.[s].color ?? 'var(--dim)' }}>
            <strong class="tug-side__name">{sides?.[s].name ?? ''}</strong>
            <Meter value={effort[s]} color={sides?.[s].color ?? 'var(--dim)'} />
          </section>
        ))}
      </footer>
    </main>
  )
}
