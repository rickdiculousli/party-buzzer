import { useEffect, useState } from 'preact/hooks'
import { addLayer, span } from '../cues.ts'
import { bufferFor, playRecipe, primeFile } from '../sound.ts'
import { SoundList, usePreview, type SoundRow } from './SoundList.tsx'
import { Track } from './Track.tsx'
import type { NumericField } from '../cues.ts'
import type { Layer, Recipe, Source } from '../synth.ts'

const STEPS = [2000, 1000, 500, 250, 100, 50, 25, 10]

const OSCILLATORS: Source[] = ['sine', 'square', 'sawtooth', 'triangle', 'noise']

const audioEnd = (layer: Layer): number => {
  if (typeof layer.source !== 'object') return 0
  const buf = bufferFor(layer.source.file)
  return buf ? (layer.delay ?? 0) + Math.max(0, buf.duration * 1000 - (layer.head ?? 0)) : 0
}

export function Layers({
  cue,
  recipe,
  onChange,
  onRemove,
  onAdd,
}: {
  cue: string
  recipe: Recipe
  onChange: (i: number, field: NumericField, value: number) => void
  onRemove: (i: number) => void
  onAdd: (source: Source, durationMs: number) => void
}) {
  const [picking, setPicking] = useState(false)
  const [adopted, setAdopted] = useState<{ name: string; size: number }[]>([])
  const [chosen, setChosen] = useState('')
  const preview = usePreview()

  useEffect(() => {
    if (!picking) return
    fetch('/__snd/adopted')
      .then((r) => r.json())
      .then(async (b: { files: { name: string; size: number }[] }) => {
        setAdopted(b.files)
        for (const f of b.files) await primeFile(`/sounds/${f.name}`)
        setAdopted([...b.files])
      })
      .catch(() => {})
  }, [picking])

  const sourceFor = (id: string): Source =>
    id.startsWith('file:') ? { file: `/sounds/${id.slice(5)}` } : (id as Source)

  const durationOf = (source: Source): number =>
    typeof source === 'object' ? (bufferFor(source.file)?.duration ?? 0) * 1000 : 0

  const rows: SoundRow[] = [
    ...adopted.map((f) => {
      const ms = durationOf({ file: `/sounds/${f.name}` })
      return {
        id: `file:${f.name}`,
        name: f.name,
        meta: ms ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(f.size / 1024)}k`,
      }
    }),
    ...OSCILLATORS.map((o) => ({ id: String(o), name: String(o), tag: 'synth' })),
  ]

  const previewRow = (id: string) => {
    const source = sourceFor(id)
    preview.toggle(id, () => playRecipe(addLayer([], source, durationOf(source))))
  }

  const add = async () => {
    const source = sourceFor(chosen)
    if (typeof source === 'object') await primeFile(source.file)
    preview.stop()
    onAdd(source, durationOf(source))
    setPicking(false)
    setChosen('')
  }

  const spanMs = Math.max(span(recipe), ...recipe.map(audioEnd))
  const step = [...STEPS].reverse().find((s) => spanMs / s <= 8) ?? spanMs / 8
  const ticks: number[] = []
  for (let t = 0; t <= spanMs; t += step) ticks.push(t)

  return (
    <div class="layers">
      <div class="layers__head">
        <span class="eyebrow">{cue}</span>
        <span class="readout">{Math.round(spanMs)}ms</span>
      </div>
      <div class="layers__ruler">
        {ticks.map((t) => (
          <span
            key={t}
            class="layers__tick"
            style={{ left: `calc(${(8 / 520) * 100}% + ${t / spanMs} * (100% - ${(16 / 520) * 100}%))` }}
          >
            {t}
          </span>
        ))}
      </div>
      {recipe.map((layer, i) => (
        <Track
          key={i}
          layer={layer}
          spanMs={spanMs}
          onChange={(field, value) => onChange(i, field, value)}
          onRemove={() => onRemove(i)}
        />
      ))}
      <div class="harness__row">
        <button
          class="btn btn--ghost"
          onClick={() => {
            preview.stop()
            setPicking((p) => !p)
          }}
        >
          {picking ? 'Cancel' : '+ layer'}
        </button>
      </div>
      {picking && (
        <div class="layers__picker">
          <p class="eyebrow">Play one, then add it</p>
          <SoundList
            rows={rows}
            selected={chosen}
            onSelect={setChosen}
            playing={preview.playing}
            onPreview={previewRow}
            empty="No adopted sounds yet. Adopt one from the Library below."
          />
          <div class="harness__row">
            <button class="btn btn--primary" disabled={!chosen} onClick={add}>
              Add layer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
