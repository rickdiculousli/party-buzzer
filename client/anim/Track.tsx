/**
 * One layer of a cue: the audio behind, the envelope that gates it in front,
 * both on an axis the track does not own.
 *
 * Handles drag as a delta, never to an absolute position: a handle's absolute x
 * is the sum of every stage before it, and reading a position would make the
 * handle jump to the cursor on grab.
 *
 * ponytail: no zoom, no snapping, no curve shaping, mono only. The axis is the
 * cue's own length and the harness's speed slider is the release valve for a
 * 40ms click beside a 3s bed. Add zoom when a cue actually needs it.
 */
import { useRef, useState } from 'preact/hooks'
import { clampField } from '../cues.ts'
import { peaks } from '../peaks.ts'
import { bufferFor } from '../sound.ts'
import type { Layer } from '../synth.ts'
import type { NumericField } from '../cues.ts'

const W = 520
const H = 72
const PAD = 8
/** Columns of waveform drawn across the full width. Chrome, not a tunable. */
const COLS = 260
/**
 * How close to the clip's left edge a press means "slide the audio" rather than
 * "move the layer". Audacity's rule, and measured in pixels because it is a
 * pointing target rather than a duration.
 */
const EDGE_PX = 6

type Handle = { field: NumericField; x: number; y: number; level: boolean }

/**
 * What each gesture does, in the words the panel says out loud.
 *
 * A waveform with four dots on it does not explain itself, and the two drags
 * that share the track body — move the layer, slide the audio inside it —
 * differ by six pixels of pointer position and nothing visible at all. So the
 * track says which one it is about to do, and the cursor agrees with the
 * sentence: `col-resize` where the clip edge is grabbable, `ew-resize` on a
 * handle that only travels sideways, `move` on the one corner that travels in
 * both. Naming the axis is the part that matters: every field here is a
 * horizontal drag except `level`, and nothing else on screen says so.
 */
const GESTURE: Record<string, { hint: string; cursor: string }> = {
  delay: { hint: '← drag the body → move this layer in time', cursor: 'grab' },
  head: { hint: '← drag the edge → slide the audio inside the clip', cursor: 'col-resize' },
  attack: { hint: '← attack →', cursor: 'ew-resize' },
  decay: { hint: '← decay →, ↑ level ↓', cursor: 'move' },
  sustain: { hint: '← sustain →', cursor: 'ew-resize' },
  release: { hint: '← release →', cursor: 'ew-resize' },
}

export function Track({
  layer,
  spanMs,
  onChange,
  onRemove,
}: {
  layer: Layer
  spanMs: number
  onChange: (field: NumericField, value: number) => void
  onRemove: () => void
}) {
  const box = useRef<SVGSVGElement>(null)
  /**
   * Which gesture the pointer is currently over, or in the middle of.
   *
   * Held as state rather than read at press time because it drives the cursor
   * and the caption, both of which have to be right *before* you commit to the
   * drag — an affordance you only discover by trying it is not an affordance.
   */
  const [over, setOver] = useState('')
  const d0 = layer.delay ?? 0
  const a = layer.attack ?? 0
  const d = layer.decay ?? 0
  const h = layer.sustain ?? 0
  const r = layer.release ?? 0
  const s = layer.level ?? 0
  const end = d0 + a + d + h + r

  const x = (t: number) => PAD + (t / spanMs) * (W - PAD * 2)
  const y = (v: number) => H - PAD - v * (H - PAD * 2)

  const file = typeof layer.source === 'object' ? layer.source.file : null
  const buf = file ? bufferFor(file) : undefined
  const durMs = buf ? buf.duration * 1000 : 0
  const head = layer.head ?? 0

  /**
   * The audio, as two paths: the part the envelope lets through and the part it
   * gates off. Drawing the tail dimmed rather than clipping it away is the
   * reason to draw a waveform at all — you can see what you are cutting, and
   * drag it back.
   *
   * One path per side rather than a rect per column: a few hundred SVG nodes
   * that re-render on every pointermove is the difference between a smooth drag
   * and a slideshow.
   */
  let lit = ''
  let dim = ''
  if (buf) {
    const data = buf.getChannelData(0)
    const from = Math.min(data.length, Math.floor((head / 1000) * buf.sampleRate))
    const visible = data.subarray(from)
    const cols = peaks(visible, COLS)
    const audioMs = Math.max(0, durMs - head)
    const mid = (H - PAD * 2) / 2 + PAD
    const half = (H - PAD * 2) / 2
    for (let c = 0; c < cols.length; c++) {
      const t = d0 + (c / cols.length) * audioMs
      if (t > spanMs) break
      const px = x(t).toFixed(2)
      const top = (mid - cols[c].max * half).toFixed(2)
      const bot = (mid - cols[c].min * half).toFixed(2)
      const seg = `M${px} ${top}V${bot}`
      if (t <= end) lit += seg
      else dim += seg
    }
  }

  const handles: Handle[] = [
    { field: 'attack', x: x(d0 + a), y: y(1), level: false },
    { field: 'decay', x: x(d0 + a + d), y: y(s), level: true },
    { field: 'sustain', x: x(d0 + a + d + h), y: y(s), level: false },
    { field: 'release', x: x(end), y: y(0), level: false },
  ]
  const points = `${x(d0)},${y(0)} ${handles.map((p) => `${p.x},${p.y}`).join(' ')}`

  /** ms per client pixel, accounting for however wide the SVG actually laid out. */
  const perPx = () => {
    const rect = box.current!.getBoundingClientRect()
    return spanMs / ((W - PAD * 2) * (rect.width / W))
  }

  /**
   * One drag, one field. Everything on this track is the same gesture with a
   * different field under it, so there is one implementation: capture where the
   * pointer and the value started, then move the value by the delta.
   */
  const drag = (e: PointerEvent, field: NumericField, alsoLevel = false) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const rect = box.current!.getBoundingClientRect()
    const scale = perPx()
    const from = { x: e.clientX, y: e.clientY, v: layer[field] ?? 0, s }

    const move = (m: PointerEvent) => {
      onChange(field, clampField(field, from.v + (m.clientX - from.x) * scale, durMs))
      if (alsoLevel) {
        const dy = (m.clientY - from.y) / (rect.height * ((H - PAD * 2) / H))
        onChange('level', clampField('level', from.s - dy))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * The body drag and the clip's left edge share a boundary, so the edge wins
   * inside its hit zone and the body takes everything else. Same rule Audacity
   * uses: near the edge you are trimming, anywhere else you are moving.
   *
   * One function answers it for both the press and the hover, so the cursor
   * cannot promise one gesture and the press deliver the other.
   */
  const zoneAt = (clientX: number): 'head' | 'delay' => {
    if (!file || !box.current) return 'delay'
    const rect = box.current.getBoundingClientRect()
    const clipLeft = rect.left + (x(d0) / W) * rect.width
    return Math.abs(clientX - clipLeft) <= EDGE_PX ? 'head' : 'delay'
  }

  const gesture = GESTURE[over]

  return (
    <div class="track">
      <svg
        ref={box}
        class="track__canvas"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={file ?? String(layer.source)}
        style={{ cursor: gesture?.cursor ?? 'grab' }}
        // Preact bails out when the value is unchanged, so this re-renders on
        // crossing the six-pixel boundary and not on every mouse move — which
        // matters, because a render here rebuilds the whole waveform path.
        onPointerMove={(e) => setOver(zoneAt((e as unknown as PointerEvent).clientX))}
        onPointerLeave={() => setOver('')}
        onPointerDown={(e) => {
          const p = e as unknown as PointerEvent
          drag(p, zoneAt(p.clientX))
        }}
      >
        <path class="track__wave" d={lit} />
        <path class="track__wave track__wave--gated" d={dim} />
        {/* The clip's left edge, drawn only when there is audio to slide. It is
            a marker, not a hit target — `zoneAt` owns the hit test in client
            pixels, because a rect in viewBox units would shrink with the panel
            and stop being a six-pixel pointing target. */}
        {file && (
          <line
            class={over === 'head' ? 'track__grip is-live' : 'track__grip'}
            x1={x(d0)}
            x2={x(d0)}
            y1={PAD}
            y2={H - PAD}
          />
        )}
        <polyline class="track__env" points={points} />
        {handles.map((hnd) => (
          <circle
            key={hnd.field}
            class={hnd.level ? 'track__handle track__handle--free' : 'track__handle'}
            cx={hnd.x}
            cy={hnd.y}
            r={6}
            onPointerEnter={() => setOver(hnd.field)}
            onPointerMove={(e) => {
              // The svg's own move handler would otherwise take the hint back
              // the instant the pointer moved a pixel on top of the handle.
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
              // Stops the body from also starting a delay drag underneath.
              e.stopPropagation()
              drag(e as unknown as PointerEvent, hnd.field, hnd.level)
            }}
          >
            <title>{GESTURE[hnd.field].hint}</title>
          </circle>
        ))}
      </svg>
      <button class="track__remove" title="remove layer" onClick={onRemove}>
        ×
      </button>
      {/* Reserved whether or not it is filled, so the tracks below do not jump
          up and down as the pointer crosses the stack. */}
      <p class="track__hint">{gesture?.hint ?? ' '}</p>
    </div>
  )
}
