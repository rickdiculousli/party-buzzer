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
import { span } from '../cues.ts'
import { bufferFor, primeFile } from '../sound.ts'
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
  const [adopted, setAdopted] = useState<{ name: string }[]>([])
  useEffect(() => {
    fetch('/__snd/adopted')
      .then((r) => r.json())
      .then((b) => setAdopted(b.files))
      .catch(() => {})
  }, [])

  /**
   * Decode before adding, so the new layer's `hold` can be the file's real
   * length. A file layer is gated like any other and one with no stages is
   * silent — this default is what stops the front door from handing you a
   * layer that does nothing.
   */
  const addFile = async (name: string) => {
    const url = `/sounds/${name}`
    await primeFile(url)
    onAdd({ file: url }, (bufferFor(url)?.duration ?? 0) * 1000)
    setPicking(false)
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
        <button class="btn btn--ghost" onClick={() => setPicking((p) => !p)}>
          + layer
        </button>
      </div>
      {picking && (
        <div class="layers__picker">
          {adopted.map((f) => (
            <button key={f.name} class="btn" onClick={() => addFile(f.name)}>
              {f.name}
            </button>
          ))}
          {OSCILLATORS.map((o) => (
            <button
              key={String(o)}
              class="btn"
              onClick={() => {
                onAdd(o, 0)
                setPicking(false)
              }}
            >
              {String(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
