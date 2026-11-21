import { useRef, useState } from 'preact/hooks'
import { clampField } from '../cues.ts'
import { peaks } from '../peaks.ts'
import { bufferFor } from '../sound.ts'
import type { Layer } from '../synth.ts'
import type { NumericField } from '../cues.ts'

const W = 520
const H = 72
const PAD = 8
const COLS = 260
const EDGE_PX = 6

type Handle = { field: NumericField; x: number; y: number; level: boolean }

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

  const perPx = () => {
    const rect = box.current!.getBoundingClientRect()
    return spanMs / ((W - PAD * 2) * (rect.width / W))
  }

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
        onPointerMove={(e) => setOver(zoneAt((e as unknown as PointerEvent).clientX))}
        onPointerLeave={() => setOver('')}
        onPointerDown={(e) => {
          const p = e as unknown as PointerEvent
          drag(p, zoneAt(p.clientX))
        }}
      >
        <path class="track__wave" d={lit} />
        <path class="track__wave track__wave--gated" d={dim} />
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
              e.stopPropagation()
            }}
            onPointerDown={(e) => {
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
      <p class="track__hint">{gesture?.hint ?? ' '}</p>
    </div>
  )
}
