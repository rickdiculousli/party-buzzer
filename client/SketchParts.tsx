import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { MAX_STROKE_POINTS, quantizePoint, type InkPoint, type InkStrokeView } from '../shared/protocol.ts'
import { DRAFT_MS, draftClear, draftStroke, draftUndo, liveDraft, strokePath, type InkDraft } from './ink.ts'
import { HoldButton } from './InkParts.tsx'
import { CHAT_SLIDE_MS, MISS_GAP_MS, chatSlideMs, chatStarts, fmtSeconds, pushChat, wipeCut, sketchCues, type ChatLine, type SketchView } from './sketch.ts'
import { play } from './sound.ts'
import { ScoreChange, reduced, useFlip } from './fx.tsx'
import type { SketchCorrect, SketchMiss } from '../shared/protocol.ts'

/** The drawing's shape everywhere it appears. */
const W = 400
const H = 300

/** Keeps the last strokes; frames carry them only when they changed and once a second. */
export function useSketchStrokes(frame: { matchId: string; strokes?: InkStrokeView[] } | null) {
  const strokes = useRef<InkStrokeView[] | null>(null)
  const match = useRef('')
  if (frame && match.current !== frame.matchId) {
    match.current = frame.matchId
    strokes.current = null
  }
  if (frame?.strokes) strokes.current = frame.strokes
  return strokes.current
}

/** Plays this surface's cues as frames arrive. `who` is 'board' or the phone's player id. */
export function useSketchCues(frame: SketchView | null, who: string | null) {
  const prev = useRef<SketchView | null>(null)
  const lastMiss = useRef(0)
  useEffect(() => {
    if (!frame || !who) return
    for (const { cue, rateScale } of sketchCues(prev.current, frame, who)) {
      if (cue === 'sketch-miss') {
        const now = performance.now()
        if (now - lastMiss.current < MISS_GAP_MS) continue
        lastMiss.current = now
      }
      play(cue, { rateScale })
    }
    prev.current = frame
  }, [frame, who])
}

/** The word as the room guesses it: one slot per letter, so its length reads at a glance. */
export function Blanks({ text, class: cls = '' }: { text: string; class?: string }) {
  return <p class={`sketch-blanks ${cls}`} aria-label={`${text.split('_').length - 1} letters hidden`}>
    {[...text].map((ch, i) => ch === ' '
      ? <span key={i} class="sketch-blanks__gap" />
      : <span key={i} class="sketch-blanks__slot">{ch === '_' ? '' : ch}</span>)}
  </p>
}

export type SketchRow = { key: string; label: string; color: string; score: number }

/** The board's sidebar, built from the same rows as the quiz standings. */
export function SketchStandings({ title, rows }: { title: string; rows: SketchRow[] }) {
  const list = useRef<HTMLOListElement>(null)
  useFlip(list)
  return <aside class="board__side">
    <div class="board__standings" data-review-id="board:standings">
      <p class="eyebrow">{title}</p>
      <ol class="stack" ref={list}>
        {rows.map((r, i) => (
          <li key={r.key} data-key={r.key} class="row fx-pop" style={{ borderLeftColor: r.color }}>
            <span class={i < 3 ? `rank rank--${i + 1}` : 'rank'}>{i < 3 ? ['1st', '2nd', '3rd'][i] : ''}</span>
            <span class="row__label">{r.label}</span>
            <ScoreChange class="row__score readout" score={r.score} />
          </li>
        ))}
      </ol>
    </div>
  </aside>
}

/** Lines the board's chat shows at once. */
const CHAT_MAX = 10
/** The space between chat lines, --s1 in the stylesheet. */
const CHAT_GAP = 4

/**
 * The board's guesses as a stream's chat: one list, bottom-anchored, kept by
 * `pushChat`. A new line slides in at the foot and pushes every line above it
 * up one slot together; a wrong guess that falls off the top fades out where it
 * stood; right guesses that reach the top stay there.
 *
 * Motion is measured against the column, not the list: the list itself moves
 * while it fills, and a line's place in it does not. Lines are one line tall,
 * so the train moves in whole slots.
 */
export function SketchChat({ turn, misses, correct, nameOf, colorOf }: {
  turn: string
  misses: SketchMiss[]
  correct: SketchCorrect[]
  nameOf: (id: string) => string
  colorOf: (id: string) => string
}) {
  // `leaving` holds lines the deque has let go of that are still on screen: a
  // line is gone from the chat when it has slid out, not when it is dropped.
  const chat = useRef({ turn: '', seen: 0, lines: [] as ChatLine[], leaving: new Map<number, ChatLine>() })
  const [, redraw] = useState(0)
  const list = useRef<HTMLOListElement>(null)
  // Each line's resting place in the column after the last change.
  const places = useRef(new Map<string, number>())
  // Frames arrive many times a second; only one that changed the lines moves them.
  const changed = useRef(false)
  // When the slide in flight will settle.
  const settles = useRef(0)
  // Dropped lines being wiped by the line rising under them, and the frame loop doing it.
  const wiping = useRef(new Map<HTMLElement, { until: number; done: () => void }>())
  const wipeLoop = useRef(0)
  const wipe = () => {
    if (wipeLoop.current) return
    const frame = () => {
      const t = performance.now()
      for (const [row, { until, done }] of wiping.current) {
        if (t >= until) { done(); continue }
        let next = row.nextElementSibling as HTMLElement | null
        while (next?.classList.contains('is-gone')) next = next.nextElementSibling as HTMLElement | null
        const box = row.getBoundingClientRect()
        const cut = wipeCut(box.top, box.bottom, next ? next.getBoundingClientRect().top : null, CHAT_GAP)
        row.style.clipPath = `inset(0 0 ${cut}px 0)`
      }
      wipeLoop.current = wiping.current.size ? requestAnimationFrame(frame) : 0
    }
    wipeLoop.current = requestAnimationFrame(frame)
  }
  useEffect(() => () => cancelAnimationFrame(wipeLoop.current), [])

  if (chat.current.turn !== turn) {
    chat.current = { turn, seen: 0, lines: [], leaving: new Map() }
    places.current = new Map()
  }
  const incoming: ChatLine[] = [
    ...misses.filter((m) => m.seq > chat.current.seen),
    ...correct.filter((c) => c.seq > chat.current.seen).map(({ seq, player, ms }) => ({ seq, player, text: null, ms })),
  ]
  if (incoming.length) {
    const { lines, evicted } = pushChat(chat.current.lines, incoming, CHAT_MAX)
    chat.current.lines = lines
    chat.current.seen = Math.max(chat.current.seen, ...incoming.map((l) => l.seq))
    for (const line of evicted) chat.current.leaving.set(line.seq, line)
    changed.current = true
  }
  // One list in arrival order, leaving lines where they were, so no element
  // ever moves in the DOM and a slide in flight is never cut short.
  const shown = [...chat.current.lines, ...chat.current.leaving.values()].sort((a, b) => a.seq - b.seq)

  useLayoutEffect(() => {
    const ol = list.current
    if (!ol || !changed.current) return
    changed.current = false
    const all = [...ol.children] as HTMLElement[]
    const rows = all.filter((row) => !row.classList.contains('is-gone'))
    const now = new Map(rows.map((row) => [row.dataset.key!, ol.offsetTop + row.offsetTop]))
    const before = places.current
    places.current = now
    const moving = !reduced()
    const carriedOf = (row: HTMLElement) => parseFloat(getComputedStyle(row).translate.split(' ')[1] ?? '') || 0
    const at = performance.now()
    const ms = settles.current > at ? chatSlideMs(at, settles.current) : CHAT_SLIDE_MS
    settles.current = at + ms

    // Lines just let go of: out of the flow, so the rest close up, but held
    // where they stand, finishing any slide they were in. Each frame the line
    // rising under one cuts it off at its own top edge, so a dropped line is
    // wiped away by the next one arriving and the two never overlap; it is
    // removed once the slide is over.
    const going = all.filter((row) => row.classList.contains('is-gone') && !row.dataset.going)
    for (const row of going) {
      const seq = Number(row.dataset.key)
      const was = before.get(row.dataset.key!)
      const done = () => { wiping.current.delete(row); chat.current.leaving.delete(seq); redraw((n) => n + 1) }
      if (was === undefined || !moving) { done(); continue }
      row.dataset.going = '1'
      const carried = carriedOf(row)
      row.style.top = `${was - ol.offsetTop}px`
      row.style.transition = 'none'
      row.style.translate = `0 ${carried}px`
      void row.offsetWidth
      row.style.transition = `translate ${ms}ms var(--ease)`
      row.style.translate = ''
      wiping.current.set(row, { until: at + ms, done })
    }
    if (going.length && wiping.current.size) wipe()

    if (!moving) return
    const starts = chatStarts(rows.map((row) => ({
      key: row.dataset.key!, before: before.get(row.dataset.key!), now: now.get(row.dataset.key!)!,
      carried: carriedOf(row), height: row.offsetHeight,
    })), CHAT_GAP)
    for (const row of rows) {
      const dy = starts.get(row.dataset.key!)!
      if (!dy) continue
      row.style.transition = 'none'
      row.style.translate = `0 ${dy}px`
      void row.offsetWidth
      row.style.transition = `translate ${ms}ms var(--ease)`
      row.style.translate = ''
    }
  })

  const line = (l: ChatLine) => l.text === null
    ? <><span class="sketch-name" style={{ '--id': colorOf(l.player) }}>{nameOf(l.player)}</span> got it <span class="readout readout--ms">{fmtSeconds(l.ms ?? 0)}</span></>
    : <><span class="sketch-name" style={{ '--id': colorOf(l.player) }}>{nameOf(l.player)}</span> {l.text}</>

  return <div class="sketch-chat" aria-live="polite">
    <ol class="sketch-chat__list" ref={list}>
      {shown.map((l) => {
        const gone = chat.current.leaving.has(l.seq)
        return <li key={l.seq} data-key={l.seq} class={`sketch-chat__line${l.text === null ? ' is-got' : ''}${gone ? ' is-gone' : ''}`}>{line(l)}</li>
      })}
    </ol>
  </div>
}

export function SketchInk({ strokes, live, class: cls = '' }: { strokes: InkStrokeView[]; live: InkPoint[] | null; class?: string }) {
  return <svg class={`sketch-ink ${cls}`} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    {strokes.map((stroke, i) => <path key={i} d={strokePath(stroke.points, W, H)} class="ink-stroke" />)}
    {live && <path d={strokePath(live, W, H)} class="ink-stroke is-live" />}
  </svg>
}

/**
 * The drawer's canvas. Sends the live stroke every 50 ms and commits on lift.
 * The phone shows its own draft until the server has processed every stroke,
 * undo and clear it sent.
 */
export function SketchCanvas({ strokes, author, processed, send, onPass }: {
  strokes: InkStrokeView[]
  author: string
  processed: number
  send: (input: { kind: 'ink'; points: InkPoint[] } | { kind: 'stroke'; points: InkPoint[] } | { kind: 'undo' } | { kind: 'clear' }) => void
  onPass: () => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const points = useRef<InkPoint[] | null>(null)
  const draft = useRef<InkDraft | null>(null)
  const lastSent = useRef(0)
  const [, redraw] = useState(0)
  draft.current = liveDraft(draft.current, processed, performance.now())
  const shown = draft.current?.strokes ?? strokes
  const server = { processed, strokes }

  const at = (event: PointerEvent): InkPoint => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return quantizePoint(0, 0)
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return quantizePoint(point.x / W, point.y / H)
  }
  const commit = (next: InkDraft, input: { kind: 'stroke'; points: InkPoint[] } | { kind: 'undo' } | { kind: 'clear' }) => {
    draft.current = next
    send(input)
    setTimeout(() => redraw((n) => n + 1), DRAFT_MS)
    redraw((n) => n + 1)
  }
  const finish = () => {
    const stroke = points.current?.slice(0, MAX_STROKE_POINTS)
    points.current = null
    if (stroke?.length) commit(draftStroke(draft.current, server, { points: stroke, author }, performance.now()), { kind: 'stroke', points: stroke })
    else redraw((n) => n + 1)
  }
  return <>
    <div
      class="sketch-stage sketch-canvas-area"
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
          send({ kind: 'ink', points: points.current.slice(0, MAX_STROKE_POINTS) })
        }
        redraw((n) => n + 1)
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <svg ref={svg} class="sketch-canvas" viewBox={`0 0 ${W} ${H}`}>
        {shown.map((stroke, i) => <path key={i} d={strokePath(stroke.points, W, H)} class="ink-stroke" />)}
        {points.current && <path d={strokePath(points.current, W, H)} class="ink-stroke is-live" />}
      </svg>
    </div>
    {/* In the thumb's reach, and only Undo acts on a tap: wiping the drawing
        or giving up the turn takes a hold. */}
    <div class="sketch-tools">
      <button class="btn" disabled={!shown.length} onClick={() => commit(draftUndo(draft.current, server, performance.now()), { kind: 'undo' })}>Undo</button>
      <HoldButton label="Hold to clear" onHeld={() => { if (shown.length) commit(draftClear(draft.current, server, performance.now()), { kind: 'clear' }) }} />
      <HoldButton label="Hold to pass" onHeld={onPass} />
    </div>
  </>
}
