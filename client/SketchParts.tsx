import { useEffect, useRef, useState } from 'preact/hooks'
import { MAX_STROKE_POINTS, quantizePoint, type InkPoint, type InkStrokeView } from '../shared/protocol.ts'
import { DRAFT_MS, draftClear, draftStroke, draftUndo, liveDraft, strokePath, type InkDraft } from './ink.ts'
import { HoldButton } from './InkParts.tsx'
import { MISS_GAP_MS, sketchCues, type SketchView } from './sketch.ts'
import { play } from './sound.ts'

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
      class="sketch-canvas-area"
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
    <div class="sketch-canvas__buttons">
      <button class="btn" disabled={!shown.length} onClick={() => commit(draftUndo(draft.current, server, performance.now()), { kind: 'undo' })}>Undo</button>
      <button class="btn" disabled={!shown.length} onClick={() => commit(draftClear(draft.current, server, performance.now()), { kind: 'clear' })}>Clear</button>
      <HoldButton label="Pass (hold)" onHeld={onPass} />
    </div>
  </>
}
