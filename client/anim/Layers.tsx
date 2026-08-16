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
import { span } from '../cues.ts'
import { bufferFor } from '../sound.ts'
import { Track } from './Track.tsx'
import type { NumericField } from '../cues.ts'
import type { Layer, Recipe } from '../synth.ts'

/** Ruler steps, coarsest first. The first one that yields ≤8 marks wins. */
const STEPS = [2000, 1000, 500, 250, 100, 50, 25, 10]

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
}: {
  cue: string
  recipe: Recipe
  onChange: (i: number, field: NumericField, value: number) => void
  onRemove: (i: number) => void
}) {
  const spanMs = Math.max(span(recipe), ...recipe.map(audioEnd))
  // Finest-first: STEPS is coarsest-first, and `find` over a descending list
  // stops at the first (coarsest) step that satisfies the test — which for a
  // 216ms cue is `2000`, one tick. Reversed, the first hit is the finest step
  // that still fits, which is the one actually worth drawing.
  const step = [...STEPS].reverse().find((s) => spanMs / s <= 8) ?? STEPS[0]
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
    </div>
  )
}
