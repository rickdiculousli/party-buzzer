/**
 * Every layer of one cue on one shared timeline.
 *
 * The shared axis is the whole point: scaling each layer to its own length
 * makes two layers of different lengths incomparable, which is exactly what
 * matters when you are combining two sounds. The span is recomputed from the
 * recipe on every render, so it grows under you as you drag a layer later.
 *
 * ponytail: no cross-cue view — one cue at a time, which is what a scenario
 * shows anyway.
 */
import { useEffect, useState } from 'preact/hooks'
import { addLayer, span } from '../cues.ts'
import { bufferFor, playRecipe, primeFile } from '../sound.ts'
import { SoundList, usePreview, type SoundRow } from './SoundList.tsx'
import { Track } from './Track.tsx'
import type { NumericField } from '../cues.ts'
import type { Layer, Recipe, Source } from '../synth.ts'

/** Ruler steps, coarsest first. The first one that yields ≤8 marks wins. */
const STEPS = [2000, 1000, 500, 250, 100, 50, 25, 10]

/**
 * The sources a layer may take. Files come from the server; the oscillators are
 * a literal because there are five of them and there always will be — the
 * picker was needed for files regardless, so covering them costs an array.
 */
const OSCILLATORS: Source[] = ['sine', 'square', 'sawtooth', 'triangle', 'noise']

/**
 * The axis has to outlast the envelope, not just match it.
 *
 * `span` measures the envelope, which is what *plays*; a file layer's audio
 * can run past it, and that gated tail is the thing you came here to see —
 * an axis that stopped at the envelope would clip away exactly what the
 * dimmed drawing is for. Only a decoded buffer widens it, so a track whose
 * decode has not landed simply draws to the envelope until it has.
 */
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

  /**
   * The adopted list, decoded on arrival.
   *
   * Decoding all of them up front is what lets the list show durations, and a
   * duration is the one measurement that actually helps you choose — kilobytes
   * tell you about the encoding, not the sound. These are small local files
   * that the board will decode anyway.
   */
  useEffect(() => {
    if (!picking) return
    fetch('/__snd/adopted')
      .then((r) => r.json())
      .then(async (b: { files: { name: string; size: number }[] }) => {
        setAdopted(b.files)
        for (const f of b.files) await primeFile(`/sounds/${f.name}`)
        // The durations arrive with the decodes, so re-render once they have.
        setAdopted([...b.files])
      })
      .catch(() => {})
  }, [picking])

  /** What `+ layer` would actually add for this row — previewed, then added. */
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
        // Size until the decode lands, because a row with no measurement at all
        // reads as a broken row rather than a pending one.
        meta: ms ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(f.size / 1024)}k`,
      }
    }),
    ...OSCILLATORS.map((o) => ({ id: String(o), name: String(o), tag: 'synth' })),
  ]

  /**
   * Hear the layer, not the file.
   *
   * The preview renders exactly what `+ layer` would put on the timeline —
   * same default envelope, same gain — because the question you are asking a
   * candidate is "what does this sound like *as a layer of this cue*", and a
   * raw file playing at full volume answers a different one.
   */
  const previewRow = (id: string) => {
    const source = sourceFor(id)
    preview.toggle(id, () => playRecipe(addLayer([], source, durationOf(source))))
  }

  /**
   * Decode before adding, so the new layer's `sustain` can be the file's real
   * length. A file layer is gated like any other and one with no segments is
   * silent — this default is what stops the front door from handing you a
   * layer that does nothing.
   */
  const add = async () => {
    const source = sourceFor(chosen)
    if (typeof source === 'object') await primeFile(source.file)
    preview.stop()
    onAdd(source, durationOf(source))
    setPicking(false)
    setChosen('')
  }

  const spanMs = Math.max(span(recipe), ...recipe.map(audioEnd))
  // Finest-first: STEPS is coarsest-first, and `find` over a descending list
  // stops at the first (coarsest) step that satisfies the test — which for a
  // 216ms cue is `2000`, one tick. Reversed, the first hit is the finest step
  // that still fits, which is the one actually worth drawing.
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
        {/* Insets to match Track's PAD (8 of its 520 width): the SVG's t=0 does
            not sit at the canvas edge, so a tick placed across the ruler's full
            width drifts left of the envelope it is meant to label. */}
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
