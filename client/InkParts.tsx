import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ClientMsg, InkPoint, InkRowView, InkTeamName, MinigameFrame, State } from '../shared/protocol.ts'
import {
  DRAFT_MS, FORCE_MS, ROW_ASPECT, TEAM_LABEL, TOUCH_MS, draftCanUndo, draftStroke, draftUndo, liveDraft, lobbyColumns,
  quantizePoint, strokePath, type InkDraft, type TimedTouch,
} from './ink.ts'
import { colorForPlayer } from './ui.ts'

type InkFrame = Extract<MinigameFrame, { id: 'ink'; role: 'board' | 'player' }>
const W = 500
const H = W / ROW_ASPECT

/** Keeps the last full pad; frames only carry it when it changed. */
export function useInkPad(frame: InkFrame | null) {
  const pad = useRef<InkFrame['pad'] | null>(null)
  const match = useRef('')
  if (frame && match.current !== frame.matchId) {
    match.current = frame.matchId
    pad.current = null
  }
  if (frame?.pad) pad.current = frame.pad
  return pad.current ?? null
}

/** Re-renders while touch rings are fading. */
export function useTouchClock(touches: TimedTouch[]) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!touches.length) return
    const id = setInterval(() => setTick((n) => n + 1), 50)
    const stop = setTimeout(() => clearInterval(id), TOUCH_MS + 50)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [touches])
}

/** Seats kept open per team, so a lobby of any size lays out the same. */
const LOBBY_SEATS = 8

export function InkLobby({ state, playerId, send }: { state: State; playerId?: string | null; send?: (msg: ClientMsg) => void }) {
  const columns = lobbyColumns(state)
  const mine = playerId ? state.minigame?.lobby?.teams[playerId] : undefined
  const volunteering = !!playerId && !!state.minigame?.lobby?.volunteers.includes(playerId)
  return <section class="ink-lobby">
    {columns.map((column) => <div key={column.team} class={`ink-lobby__team ink-lobby__team--${column.team}`}>
      <header>
        <span class="eyebrow">{TEAM_LABEL[column.team]}</span>
        <span class={column.over ? 'readout ink-lobby__count is-over' : 'readout ink-lobby__count'}>{column.count}/{column.cap}</span>
      </header>
      <ul>
        {column.members.map((member) => <li key={member.id} style={{ color: colorForPlayer(state, member.id) }}>
          {member.name}{member.volunteer && <span class="ink-lobby__star" aria-label="volunteer to write"> ✎</span>}
        </li>)}
        {/* Empty seats hold the buttons still as players join and leave. */}
        {Array.from({ length: Math.max(0, LOBBY_SEATS - column.members.length) }, (_, i) =>
          <li key={`seat${i}`} class="ink-lobby__seat" aria-hidden="true">{'\u00a0'}</li>)}
      </ul>
      {/* One word each: a wrapped "Join Moon" would stand taller than "Leave". */}
      {send && <button
        class={mine === column.team ? 'btn btn--primary' : 'btn'}
        aria-label={mine === column.team ? `Leave ${TEAM_LABEL[column.team]}` : `Join ${TEAM_LABEL[column.team]}`}
        onClick={() => send({ t: 'minigameLobby', change: mine === column.team ? { do: 'leave' } : { do: 'join', team: column.team } })}
      >{mine === column.team ? 'Leave' : 'Join'}</button>}
    </div>)}
    {send && mine && <button
      class={volunteering ? 'btn btn--primary ink-lobby__volunteer' : 'btn ink-lobby__volunteer'}
      onClick={() => send({ t: 'minigameLobby', change: { do: 'volunteer', on: !volunteering } })}
    >{volunteering ? 'Volunteering to write' : 'Volunteer to write'}</button>}
  </section>
}

/** Taps away from buttons become touches; recent touches on this target draw as fading rings. */
export function Touchable({ state, target, touches, onTouch, class: className, children }: {
  state: State
  target: string
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  class?: string
  children: ComponentChildren
}) {
  const now = performance.now()
  return <div
    class={`ink-touchable ${className ?? ''}`}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => {
      if (!onTouch || (event.target as Element).closest('button, .ink-canvas')) return
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      onTouch(target, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)
    }}
  >
    {children}
    {touches.filter((touch) => touch.target === target && now - touch.at <= TOUCH_MS).map((touch) => (
      <span
        key={`${touch.playerId}-${touch.at}`}
        class="ink-ring"
        style={{ left: `${touch.x * 100}%`, top: `${touch.y * 100}%`, '--ring': `${Math.max(0, 1 - (now - touch.at) / TOUCH_MS)}`, '--ring-color': colorForPlayer(state, touch.playerId) } as Record<string, string>}
      ><span class="ink-ring__name">{touch.name}</span></span>
    ))}
  </div>
}

export function VotePips({ state, votes, choice }: { state: State; votes: { player: string; choice: string }[]; choice: (vote: string) => boolean }) {
  return <span class="ink-pips">
    {votes.filter((vote) => choice(vote.choice)).map((vote) => (
      <span key={vote.player} class="ink-pip" style={{ background: colorForPlayer(state, vote.player) }} />
    ))}
  </span>
}

/** A phase this phone only waits out: a sweeping bar under a few words for what. */
export function PendingBar({ label }: { label: string }) {
  return <div class="pending" role="status">
    <span class="pending__label">{label}</span>
    <span class="pending__track"><span class="pending__sweep" /></span>
  </div>
}

export function HoldButton({ label, onHeld }: { label: string; onHeld: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const release = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  return <button
    class={holding ? 'btn ink-force is-holding' : 'btn ink-force'}
    style={{ '--force-ms': `${FORCE_MS}ms` } as Record<string, string>}
    onPointerDown={() => {
      setHolding(true)
      timer.current = setTimeout(() => { release(); onHeld() }, FORCE_MS)
    }}
    onPointerUp={release}
    onPointerLeave={release}
    onPointerCancel={release}
  >{label}</button>
}

/** Guess rows are typed: one letter per slot, the missed one struck through. */
const LETTER_X = 14
const LETTER_STEP = 34

function RowLetters({ row }: { row: InkRowView }) {
  const last = row.letters.length - 1
  return <>
    {row.letters.map((letter, i) => {
      // Every letter sits in a slot of its own, so a thin I keeps the word evenly spelled.
      const x = LETTER_X + i * LETTER_STEP
      const missed = !!row.wrong && i === last
      return <g key={i}>
        <text x={x + LETTER_STEP / 2} y={H * 0.78} class={missed ? 'ink-letter is-wrong' : 'ink-letter'}>{letter}</text>
        {missed && <line x1={x + 2} x2={x + LETTER_STEP - 2} y1={H * 0.5} y2={H * 0.5} class="ink-strike" />}
      </g>
    })}
  </>
}

/** The guesser's keyboard: every letter leaves for the server as it is typed. */
export function LetterEntry({ onLetter }: { onLetter: (value: string) => void }) {
  return <section class="ink-letters">
    <input
      class="ink-letters__input"
      type="text"
      autoFocus
      autocomplete="off"
      autocapitalize="characters"
      maxLength={1}
      aria-label="Next letter of the guess"
      placeholder="?"
      onInput={(event) => {
        const typed = event.currentTarget.value.trim()
        event.currentTarget.value = ''
        if (typed) onLetter(typed.slice(-1))
      }}
    />
    <p class="muted">One letter at a time. A wrong letter ends the turn.</p>
  </section>
}

function RowInk({ row, extra }: { row: InkRowView; extra?: InkPoint[][] }) {
  const struck = (i: number) => row.strikes.some(([from, to]) => i >= from && i <= to)
  if (row.kind === 'guess') return <RowLetters row={row} />
  return <>
    {row.strokes.map((stroke, i) => (
      <path key={i} d={strokePath(stroke.points, W, H)} class={`ink-stroke${stroke.peek ? ' is-peek' : ''}${struck(i) ? ' is-struck' : ''}`} />
    ))}
    {row.strikes.map(([from, to]) => {
      const points = row.strokes.slice(from, to + 1).flatMap((stroke) => stroke.points)
      const xs = points.map(([x]) => x * W)
      return <line key={from} x1={Math.min(...xs) - 4} x2={Math.max(...xs) + 4} y1={H / 2} y2={H / 2} class="ink-strike" />
    })}
    {row.ended && row.strokes.length > 0 && (() => {
      const last = Math.max(...row.strokes.flatMap((stroke) => stroke.points.map(([x]) => x)))
      return <circle cx={last * W + 10} cy={H * 0.85} r={3.5} class="ink-period" />
    })()}
    {extra?.map((points, i) => <path key={`live${i}`} d={strokePath(points, W, H)} class="ink-stroke is-live" />)}
  </>
}

export function InkRowSvg({ row, extra }: { row: InkRowView; extra?: InkPoint[][] }) {
  return <svg class="ink-row__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} class="ink-row__rule" />
    <RowInk row={row} extra={extra} />
  </svg>
}

/** Both pad pages. Peek rows carry an eye; the current row is lit. */
export function InkPad({ state, frame, pad, touches, onTouch, peekRows, pickable }: {
  state: State
  frame: InkFrame
  pad: NonNullable<InkFrame['pad']>
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  peekRows: Record<InkTeamName, number[]>
  pickable?: (target: string) => ComponentChildren
}) {
  return <div class="ink-pad">
    {(['sun', 'moon'] as const).map((team) => <div key={team} class={`ink-pad__page ink-pad__page--${team}`}>
      <p class="eyebrow">{TEAM_LABEL[team]}</p>
      {pad[team].map((row, i) => {
        const target = `${team}:${i}`
        const live = frame.live.filter((entry) => entry.team === team && entry.row === i).map((entry) => entry.points)
        const current = frame.turn === team && frame.row === i && frame.step.at !== 'over'
        return <Touchable key={i} state={state} target={`row:${target}`} touches={touches} onTouch={onTouch}
          class={`ink-row${current ? ' is-current' : ''}${row.won ? ' is-won' : ''}`}>
          <span class="ink-row__num">{i + 1}{peekRows[team].includes(i + 1) && <span class="ink-row__eye" aria-label="peek row">◉</span>}</span>
          <InkRowSvg row={row} extra={live} />
          {pickable?.(target)}
        </Touchable>
      })}
    </div>)}
  </div>
}

/**
 * Freehand capture over one row, with Undo last stroke ahead of `children`.
 * Strokes may start and run in the margin around the row. Sends the live
 * stroke every 50 ms and commits on lift. The phone shows its own draft of the
 * row until the server has processed every stroke and undo it sent.
 */
export function InkCanvas({ row, author, processed, canUndo, send, children }: {
  row: InkRowView
  author: string
  /** Stroke and undo inputs the server has processed from this phone. */
  processed: number
  /** The server's view: the player's latest stroke on this row can be undone. */
  canUndo: boolean
  send: (input: { kind: 'ink'; points: InkPoint[] } | { kind: 'stroke'; points: InkPoint[] } | { kind: 'undo' }) => void
  children?: ComponentChildren
}) {
  const svg = useRef<SVGSVGElement>(null)
  const points = useRef<InkPoint[] | null>(null)
  const draft = useRef<InkDraft | null>(null)
  const lastSent = useRef(0)
  const [, redraw] = useState(0)
  draft.current = liveDraft(draft.current, processed, performance.now())
  const shown = draft.current ? { ...row, strokes: draft.current.strokes } : row
  const undoable = draftCanUndo(draft.current, canUndo)
  const server = { processed, strokes: row.strokes }

  // The screen matrix includes any CSS rotation of the writing view, so points
  // stay in row coordinates however the phone is held.
  const at = (event: PointerEvent): InkPoint => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return quantizePoint(0, 0)
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return quantizePoint(point.x / W, point.y / H)
  }
  const expire = () => setTimeout(() => redraw((n) => n + 1), DRAFT_MS)
  const finish = () => {
    const stroke = points.current
    points.current = null
    if (stroke?.length) {
      const committed = stroke.slice(0, 500)
      draft.current = draftStroke(draft.current, server, { points: committed, author }, performance.now())
      send({ kind: 'stroke', points: committed })
      expire()
    }
    redraw((n) => n + 1)
  }
  const undo = () => {
    if (!undoable) return
    draft.current = draftUndo(draft.current, server, performance.now())
    send({ kind: 'undo' })
    expire()
    redraw((n) => n + 1)
  }
  return <>
    <div
      class="ink-canvas-area"
      onPointerDown={(event) => {
        ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
        points.current = [at(event)]
        redraw((n) => n + 1)
      }}
      onPointerMove={(event) => {
        if (!points.current) return
        points.current.push(at(event))
        const moved = performance.now()
        if (moved - lastSent.current >= 50) {
          lastSent.current = moved
          send({ kind: 'ink', points: points.current.slice(0, 500) })
        }
        redraw((n) => n + 1)
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <svg ref={svg} class="ink-canvas" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} class="ink-row__rule" />
        <RowInk row={shown} extra={points.current ? [points.current] : []} />
      </svg>
    </div>
    <div class="ink-write__buttons">
      <button class="btn" disabled={!undoable} onClick={undo}>Undo last stroke</button>
      {children}
    </div>
  </>
}
