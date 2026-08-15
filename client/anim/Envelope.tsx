/**
 * An envelope you drag rather than four sliders you infer it from.
 *
 * The sliders still exist and still work — this draws the same four numbers as
 * one shape, because attack against decay is a relationship and two independent
 * sliders hide it. Horizontal drag is time; vertical drag on the sustain corner
 * is level.
 *
 * ponytail: no zoom, no snapping, no curve shaping. The x axis is the layer's
 * own total length, so the shape rescales as you drag and stays legible for a
 * 40ms click and a 3s buzzer alike.
 */
import { useRef } from 'preact/hooks'
import type { Layer } from '../synth.ts'

const W = 260
const H = 90
const PAD = 8

type Handle = { field: 'attack' | 'decay' | 'hold' | 'release'; x: number; y: number; level: boolean }

export function Envelope({
  layer,
  onChange,
}: {
  layer: Layer
  onChange: (field: string, value: number) => void
}) {
  const box = useRef<SVGSVGElement>(null)
  const a = layer.attack ?? 0
  const d = layer.decay ?? 0
  const h = layer.hold ?? 0
  const r = layer.release ?? 0
  const s = layer.sustain ?? 0
  const total = Math.max(1, a + d + h + r)

  const x = (t: number) => PAD + (t / total) * (W - PAD * 2)
  const y = (v: number) => H - PAD - v * (H - PAD * 2)

  const handles: Handle[] = [
    { field: 'attack', x: x(a), y: y(1), level: false },
    { field: 'decay', x: x(a + d), y: y(s), level: true },
    { field: 'hold', x: x(a + d + h), y: y(s), level: false },
    { field: 'release', x: x(total), y: y(0), level: false },
  ]

  const points = `${x(0)},${y(0)} ${handles.map((p) => `${p.x},${p.y}`).join(' ')}`

  /**
   * Drag as a delta, not as a position.
   *
   * A handle's absolute x is the sum of every stage before it, so reading a
   * position would need that sum inverted; a delta only ever changes the one
   * field under the pointer, and dragging attack shifts everything after it
   * exactly as it does in the sound.
   */
  const grab = (e: PointerEvent, hnd: Handle) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const rect = box.current!.getBoundingClientRect()
    const perPx = total / ((W - PAD * 2) * (rect.width / W))
    const from = { x: e.clientX, y: e.clientY, t: layer[hnd.field] ?? 0, s }

    const move = (m: PointerEvent) => {
      onChange(hnd.field, Math.max(0, Math.round(from.t + (m.clientX - from.x) * perPx)))
      if (hnd.level) {
        const dy = (m.clientY - from.y) / (rect.height * ((H - PAD * 2) / H))
        onChange('sustain', Math.min(1, Math.max(0, Number((from.s - dy).toFixed(2)))))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <svg ref={box} class="envelope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="envelope">
      <polyline class="envelope__line" points={points} />
      {handles.map((hnd) => (
        <circle
          key={hnd.field}
          class="envelope__handle"
          cx={hnd.x}
          cy={hnd.y}
          r={6}
          onPointerDown={(e) => grab(e as unknown as PointerEvent, hnd)}
        >
          <title>{hnd.field}</title>
        </circle>
      ))}
    </svg>
  )
}
