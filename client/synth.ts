/**
 * Cues as data. A cue is a list of layers; a layer is one source with an
 * envelope on it. That is the whole vocabulary, and it is sized to the three
 * sounds on the board rather than to synthesis in general.
 *
 * The file splits at the only seam that matters: `schedule` is arithmetic and
 * runs anywhere, `render` is the WebAudio half. Everything worth getting wrong
 * is on the arithmetic side, which is why the tests need no browser.
 */

export type Source =
  | 'sine' | 'square' | 'sawtooth' | 'triangle'
  | 'noise'
  | { file: string }

export type Layer = {
  source: Source
  /** Hz at the layer's start. Ignored by `noise` and file sources. */
  freq?: number
  /** Hz to glide to, reached at the end of the layer's audible length. */
  freqTo?: number
  /** How the glide travels. `exp` is what a pitch drop actually sounds like. */
  glide?: 'lin' | 'exp'

  /** Envelope, in ms — except `sustain`, which is a level from 0 to 1. */
  attack?: number
  decay?: number
  sustain?: number
  hold?: number
  release?: number

  gain?: number
  /** Offset within the cue: intentional spacing between layers. */
  delay?: number
  /** Milliseconds into the file before playback starts. File sources only. */
  head?: number

  filter?: { type: BiquadFilterType; freq: number; freqTo?: number; q?: number }
}

export type Recipe = Layer[]

export type Step = { t: number; value: number; curve: 'set' | 'lin' | 'exp' }
export type Voice = {
  source: Source
  /** Seconds, relative to the cue's start. `render` only ever adds `t0`. */
  start: number
  stop: number
  /** Seconds into the file. File sources only; zero for everything else. */
  head: number
  freq: Step[]
  gain: Step[]
  filter?: { type: BiquadFilterType; q: number; freq: Step[] }
}

/**
 * The quietest an exponential ramp may aim for.
 *
 * `exponentialRampToValueAtTime` throws on a target of zero, and a decay to
 * silence is the obvious thing to write. -80dB is inaudible, so flooring costs
 * nothing and removes a whole class of runtime exception.
 */
export const GAIN_FLOOR = 1e-4

const ms = (v: number | undefined, rate: number) => (v ?? 0) / 1000 / rate

/**
 * A recipe as instructions, in seconds relative to the cue's own start.
 *
 * `rate` is one resampling knob, exactly as `playbackRate` is for a sample: it
 * multiplies every frequency and divides every time, so the harness at 0.1x
 * slows and lowers a synthesized cue the same way it already does a recorded
 * one.
 */
export function schedule(recipe: Recipe, rate = 1): Voice[] {
  const r = Math.max(0.05, rate)
  return recipe.map((l) => {
    const start = ms(l.delay, r)
    const attack = ms(l.attack, r)
    const decay = ms(l.decay, r)
    const hold = ms(l.hold, r)
    const release = ms(l.release, r)
    // Summed in ms, then converted once — converting each stage separately
    // and adding the results drifts a cent past the exact value in float64.
    const stop = start + ms((l.attack ?? 0) + (l.decay ?? 0) + (l.hold ?? 0) + (l.release ?? 0), r)

    const peak = Math.max(l.gain ?? 1, GAIN_FLOOR)
    const level = Math.max(peak * (l.sustain ?? 0), GAIN_FLOOR)

    const gain: Step[] = [{ t: start, value: GAIN_FLOOR, curve: 'set' }]
    const at = (t: number, value: number, curve: Step['curve']) => gain.push({ t, value, curve })
    at(start + attack, peak, 'lin')
    at(start + attack + decay, level, 'exp')
    at(start + attack + decay + hold, level, 'set')
    at(stop, GAIN_FLOOR, 'exp')

    const freq: Step[] = []
    if (l.freq !== undefined) {
      freq.push({ t: start, value: l.freq * r, curve: 'set' })
      if (l.freqTo !== undefined)
        freq.push({ t: stop, value: l.freqTo * r, curve: l.glide === 'exp' ? 'exp' : 'lin' })
    }

    const f = l.filter
    const filter = f && {
      type: f.type,
      q: f.q ?? 1,
      freq: [
        { t: start, value: f.freq * r, curve: 'set' as const },
        ...(f.freqTo === undefined
          ? []
          : [{ t: stop, value: f.freqTo * r, curve: 'exp' as const }]),
      ],
    }

    return { source: l.source, start, stop, head: ms(l.head, r), freq, gain, filter }
  })
}

/**
 * How long after a cue's start you actually hear it.
 *
 * Derived, never dialled, so it cannot drift out of step with the sound it
 * describes. For a cue that is still a sample it is zero by construction —
 * trimming dead air off the front is exactly what `head` already does.
 *
 * ponytail: measured to the envelope's peak. For a long swell the ear places
 * the moment somewhere before the peak, so a slow-attack cue reads slightly
 * late. Weight it only if a cue ever wants a swell.
 */
export function onset(r: Recipe): number {
  return r.length ? Math.min(...r.map((l) => (l.delay ?? 0) + (l.attack ?? 0))) : 0
}
