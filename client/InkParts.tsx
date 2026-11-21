import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { quantizePoint, type ClientMsg, type InkPoint, type InkRowView, type InkTeamName, type MinigameFrame, type State } from '../shared/protocol.ts'
import {
  DRAFT_MS, FORCE_MS, ROW_ASPECT, TEAM_LABEL, TOUCH_MS, draftCanUndo, draftStroke, draftUndo, liveDraft, lobbyColumns,
  strokePath, type InkDraft, type TimedTouch,
} from './ink.ts'
import { colorForPlayer, playerName } from './ui.ts'
import { mulberry32 } from '../shared/random.ts'

type InkFrame = Extract<MinigameFrame, { id: 'ink'; role: 'board' | 'player' }>
const W = 500
const H = W / ROW_ASPECT

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

export function InkDefs() {
  return <svg class="ink-defs" width="0" height="0" aria-hidden="true">
    <filter id="ink-px" filterUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
      <feFlood x="1" y="1" width="2" height="2" />
      <feComposite width="5" height="5" />
      <feTile result="grid" />
      <feComposite in="SourceGraphic" in2="grid" operator="in" />
      <feMorphology operator="dilate" radius="2.5" />
    </filter>
    <filter id="ink-pencil" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="grain" />
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.4" result="wobble" />
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.4 -0.45" result="tooth" />
      <feComposite in="wobble" in2="tooth" operator="in" />
    </filter>
  </svg>
}

export const PenIcon = () => <svg class="ink-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M3 13l1-4 6.5-6.5a1.4 1.4 0 0 1 2 2L6 11z M9.5 3.5l3 3" />
</svg>

export const EyeIcon = () => <svg class="ink-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
  <circle cx="8" cy="8" r="2" />
</svg>

const seedOf = (text: string) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)

export function DiscardSlip({ text }: { text: string }) {
  const rand = mulberry32(seedOf(text))
  const between = (a: number, b: number) => a + rand() * (b - a)
  const top = Array.from({ length: 15 }, (_, i) => `${(i / 14) * 100}% ${between(0, 4)}%`)
  const bottom = Array.from({ length: 8 }, (_, i) => `${100 - (i / 7) * 100}% ${between(90, 100)}%`)
  const passes = 5 + Math.floor(rand() * 3)
  let d = `M${between(2, 10)} ${between(18, 30)}`
  for (let i = 1; i <= passes; i++) {
    const y = 18 + (i / passes) * 62 + between(-6, 6)
    d += ` Q${between(35, 65)} ${y + between(-16, 16)} ${i % 2 ? between(88, 99) : between(1, 12)} ${y}`
  }
  return <li class="ink-slip" style={{ '--tilt': `${between(-4, 4)}deg` }}>
    <div class="ink-slip__paper" style={{ clipPath: `polygon(${[...top, ...bottom].join(',')})` }}>
      <span class="ink-slip__type">{text}</span>
      <svg class="ink-slip__scribble" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} filter="url(#ink-pencil)" />
      </svg>
    </div>
  </li>
}

const LOBBY_SEATS = 8

export function InkLobby({ state, playerId, send }: { state: State; playerId?: string | null; send?: (msg: ClientMsg) => void }) {
  const columns = lobbyColumns(state)
  const mine = playerId ? state.minigame?.lobby?.teams[playerId] : undefined
  const volunteering = !!playerId && !!state.minigame?.lobby?.volunteers.includes(playerId)
  return <section class="ink-lobby">
    {columns.map((column) => <div key={column.team} class={`ink-lobby__team ink-lobby__team--${column.team}`}>
      <header>
        <span class="ink-team-name">{TEAM_LABEL[column.team]}</span>
        <span class={column.over ? 'readout ink-lobby__count is-over' : 'readout ink-lobby__count'}>{column.count}/{column.cap}</span>
      </header>
      <ul>
        {column.members.map((member) => <li key={member.id} style={{ color: colorForPlayer(state, member.id) }}>
          {member.name}{member.volunteer && <span class="ink-lobby__star" role="img" aria-label="volunteer to write"><PenIcon /></span>}
        </li>)}
        {Array.from({ length: Math.max(0, LOBBY_SEATS - column.members.length) }, (_, i) =>
          <li key={`seat${i}`} class="ink-lobby__seat" aria-hidden="true">{'\u00a0'}</li>)}
      </ul>
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
        style={{ left: `${touch.x * 100}%`, top: `${touch.y * 100}%`, '--touch-ms': `${TOUCH_MS}ms`, '--ring-color': colorForPlayer(state, touch.playerId) } as Record<string, string>}
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

export function PendingBar({ label }: { label: string }) {
  return <div class="pending" role="status">
    <span class="pending__label">{label}</span>
    <span class="pending__track"><span class="pending__sweep" /></span>
  </div>
}

export function HoldButton({ label, onHeld, ms = FORCE_MS }: { label: string; onHeld: () => void; ms?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const release = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  return <button
    class={holding ? 'btn ink-force is-holding' : 'btn ink-force'}
    style={{ '--force-ms': `${ms}ms` } as Record<string, string>}
    onPointerDown={() => {
      setHolding(true)
      timer.current = setTimeout(() => { release(); onHeld() }, ms)
    }}
    onPointerUp={release}
    onPointerLeave={release}
    onPointerCancel={release}
  >{label}</button>
}

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
    <p class="ink-letters__rule">One letter at a time. A wrong letter ends the turn.</p>
  </section>
}

function RowLetters({ row }: { row: InkRowView }) {
  const wrong = row.wrong ? row.letters.at(-1) : null
  const kept = wrong ? row.letters.slice(0, -1) : row.letters
  return <text x={14} y={H * 0.78} class={row.won ? 'ink-letter is-won' : 'ink-letter'} filter="url(#ink-px)">
    {kept.join('')}
    {wrong && <tspan class="is-wrong">{wrong}</tspan>}
  </text>
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

const LETTER_ADVANCE = 58 * 0.6 + 6


export function InkRowSvg({ row, extra = [], cursor }: { row: InkRowView; extra?: InkPoint[][]; cursor?: boolean }) {
  return <svg class="ink-row__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} class="ink-row__rule" />
    <RowInk row={row} extra={extra} />
    {cursor && row.kind === 'guess' && <rect class="ink-cursor" x={14 + row.letters.length * LETTER_ADVANCE} y={H * 0.28} width={20} height={H * 0.5} />}
    {extra.map((points, i) => {
      const [x, y] = points[points.length - 1]
      return <circle key={`beam${i}`} class="ink-beam" cx={x * W} cy={y * H} r={5} />
    })}
  </svg>
}

export function InkRowCell({ state, frame, row, team, index, touches, onTouch, label, current, class: className, children }: {
  state: State
  frame: InkFrame
  row: InkRowView
  team: InkTeamName
  index: number
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  label: ComponentChildren
  current?: boolean
  class?: string
  children?: ComponentChildren
}) {
  const live = frame.live.filter((entry) => entry.team === team && entry.row === index).map((entry) => entry.points)
  const blank = !row.strokes.length && !row.letters.length && !live.length
  return <Touchable state={state} target={`row:${team}:${index}`} touches={touches} onTouch={onTouch}
    class={`ink-row${current ? ' is-current' : ''}${row.won ? ' is-won' : ''}${blank ? ' is-blank' : ''}${className ? ` ${className}` : ''}`}>
    <span class="ink-row__num">{label}</span>
    <InkRowSvg row={row} extra={live} cursor={current} />
    {children}
  </Touchable>
}

function FitNames({ names }: { names: string[] }) {
  const line = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(names.length)
  const [width, setWidth] = useState(0)
  const key = names.join('\u0000')
  useLayoutEffect(() => setShown(names.length), [key, width])
  useLayoutEffect(() => {
    const el = line.current
    if (el && shown > 1 && el.scrollWidth > el.clientWidth) setShown(shown - 1)
  })
  useLayoutEffect(() => {
    const el = line.current?.parentElement
    if (!el) return
    const watch = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const rest = names.length - shown
  return <span class="ink-set__guessers">
    <span ref={line} class="ink-set__names">{names.slice(0, shown).join(' · ')}</span>
    {rest > 0 && <span class="ink-set__more">+{rest}</span>}
  </span>
}

type PadProps = {
  state: State
  frame: InkFrame
  pad: NonNullable<InkFrame['pad']>
  touches: TimedTouch[]
  onTouch?: (target: string, x: number, y: number) => void
  peekRows: Record<InkTeamName, number[]>
}

export function InkScreen({ state, frame, pad, touches, onTouch, peekRows, team }: PadProps & { team: InkTeamName }) {
  const inked = pad[team].findLastIndex((row, i) => row.strokes.length || row.letters.length || frame.live.some((e) => e.team === team && e.row === i)) + 1
  const current = frame.turn === team && frame.step.at !== 'over' ? frame.row + 1 : 0
  const onAir = Math.max(inked, current) / pad[team].length
  return <div class={`ink-screen ink-screen--${team}`} style={{ '--on-air': `${onAir * 100}%` } as Record<string, string>}>
    {pad[team].map((row, i) => (
      <InkRowCell key={i} state={state} frame={frame} row={row} team={team} index={i} touches={touches} onTouch={onTouch}
        current={frame.turn === team && frame.row === i && frame.step.at !== 'over'}
        label={<>{i + 1}{peekRows[team].includes(i + 1) && <span class="ink-row__eye" role="img" aria-label="peek row"><EyeIcon /></span>}</>}
      />
    ))}
  </div>
}

export function InkPad(props: PadProps & { sets?: boolean; aside?: (team: InkTeamName) => ComponentChildren }) {
  const { state, frame, sets, aside } = props
  const nameOf = (id: string) => playerName(state, id)
  return <div class={sets ? 'ink-pad ink-pad--sets' : 'ink-pad'}>
    {sets && aside?.('sun')}
    {(['sun', 'moon'] as const).map((team) => sets
      ? <figure key={team} class={`ink-set ink-set--${team}`}>
        <InkScreen {...props} team={team} />
        <figcaption class="ink-set__chin">
          <span class="ink-team-name">{TEAM_LABEL[team]}</span>
          <span class="ink-set__roster">
            <span class="ink-set__writer"><PenIcon /><span>{nameOf(frame.roster[team].writer)}</span></span>
            <FitNames names={frame.roster[team].guessers.map(nameOf)} />
          </span>
          <span class={frame.turn === team && frame.step.at !== 'over' ? 'ink-set__pilot is-on' : 'ink-set__pilot'} role="img"
            aria-label={frame.turn === team ? 'this team’s turn' : 'waiting'} />
        </figcaption>
      </figure>
      : <InkScreen key={team} {...props} team={team} />)}
    {sets && aside?.('moon')}
  </div>
}

export function InkCanvas({ row, author, processed, canUndo, send, children }: {
  row: InkRowView
  author: string
  processed: number
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
