/**
 * One layer of a cue: the audio behind, the envelope that gates it in front,
 * both on an axis the track does not own.
 *
 * This is the old `Envelope.tsx` with the waveform it was always missing. The
 * handle math is unchanged — drag as a delta, never to an absolute position,
 * because a handle's absolute x is the sum of every stage before it and reading
 * a position would make the handle jump to the cursor on grab.
 *
 * ponytail: no zoom, no snapping, no curve shaping, mono only. The axis is the
 * cue's own length and the harness's speed slider is the release valve for a
 * 40ms click beside a 3s bed. Add zoom when a cue actually needs it.
 */
import { useRef } from 'preact/hooks'
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
  const d0 = layer.delay ?? 0
  const a = layer.attack ?? 0
  const d = layer.decay ?? 0
  const h = layer.hold ?? 0
  const r = layer.release ?? 0
  const s = layer.sustain ?? 0
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
    { field: 'hold', x: x(d0 + a + d + h), y: y(s), level: false },
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
        onChange('sustain', clampField('sustain', from.s - dy))
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
   */
  const grabBody = (e: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect()
    const clipLeft = rect.left + (x(d0) / W) * rect.width
    if (file && Math.abs(e.clientX - clipLeft) <= EDGE_PX) drag(e, 'head')
    else drag(e, 'delay')
  }

  return (
    <div class="track">
      <svg
        ref={box}
        class="track__canvas"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={file ?? String(layer.source)}
        onPointerDown={(e) => grabBody(e as unknown as PointerEvent)}
      >
        <path class="track__wave" d={lit} />
        <path class="track__wave track__wave--gated" d={dim} />
        <polyline class="track__env" points={points} />
        {handles.map((hnd) => (
          <circle
            key={hnd.field}
            class="track__handle"
            cx={hnd.x}
            cy={hnd.y}
            r={6}
            onPointerDown={(e) => {
              // Stops `grabBody` from also starting a delay drag underneath.
              e.stopPropagation()
              drag(e as unknown as PointerEvent, hnd.field, hnd.level)
            }}
          >
            <title>{hnd.field}</title>
          </circle>
        ))}
      </svg>
      <button class="track__remove" title="remove layer" onClick={onRemove}>
        ×
      </button>
    </div>
  )
}
