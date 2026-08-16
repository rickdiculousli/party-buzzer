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
import { Track } from './Track.tsx'
import type { NumericField } from '../cues.ts'
import type { Recipe } from '../synth.ts'

/** Ruler steps, coarsest first. The first one that yields ≤8 marks wins. */
const STEPS = [2000, 1000, 500, 250, 100, 50, 25, 10]

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
  const spanMs = span(recipe)
  const step = STEPS.find((s) => spanMs / s <= 8) ?? STEPS[STEPS.length - 1]
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
          <span key={t} class="layers__tick" style={{ left: `${(t / spanMs) * 100}%` }}>
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
