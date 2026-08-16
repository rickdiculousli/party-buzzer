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
  /**
   * A decoded file, keyed by the URL `primeFile` fetched it under.
   *
   * ponytail: a file layer is still gated by the envelope like any other, so
   * one written with no stages at all stops the instant it starts and is
   * silent. Give it a `decay` at least. Defaulting an envelope-less layer to
   * the buffer's own length would need the buffer, which `schedule` does not
   * have — pass its duration in if a recipe ever wants that.
   */
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
  /** The resampling rate, carried out so a file source can play at it too. */
  rate: number
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
      const exp = l.freqTo !== undefined && l.glide === 'exp'
      // An exponential ramp throws on a zero *source* as readily as on a zero
      // target, and a dial can reach `freq: 0`. Floor the value it starts from.
      freq.push({ t: start, value: exp ? Math.max(l.freq * r, GAIN_FLOOR) : l.freq * r, curve: 'set' })
      if (l.freqTo !== undefined)
        freq.push({ t: stop, value: l.freqTo * r, curve: exp ? 'exp' : 'lin' })
    }

    const f = l.filter
    const filter = f && {
      type: f.type,
      q: f.q ?? 1,
      freq: [
        // Floored for the same reason as the oscillator's: the sweep that
        // follows is exponential, and it cannot start from zero.
        { t: start, value: Math.max(f.freq * r, GAIN_FLOOR), curve: 'set' as const },
        ...(f.freqTo === undefined
          ? []
          : [{ t: stop, value: f.freqTo * r, curve: 'exp' as const }]),
      ],
    }

    // `head` is an offset into the buffer, which is buffer-domain seconds and
    // has nothing to do with the rate the buffer is then played at — unlike
    // every other time here, so it does not go through `ms()`.
    return { source: l.source, start, stop, head: (l.head ?? 0) / 1000, rate: r, freq, gain, filter }
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

/* --- the WebAudio half ---------------------------------------------------
   Nothing below is tested in Node, and nothing below decides anything: it
   walks the steps `schedule` already worked out. Any logic that creeps in
   here belongs above the line instead. */

let noise: AudioBuffer | null = null

/**
 * One second of white noise, made once and shared.
 *
 * ponytail: white only. Pink and brown are a filter away if a recipe wants
 * them.
 */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise?.sampleRate === ctx.sampleRate) return noise
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise = buf
  return buf
}

function apply(param: AudioParam, steps: Step[], t0: number): void {
  for (const s of steps) {
    const t = t0 + s.t
    if (s.curve === 'set') param.setValueAtTime(s.value, t)
    else if (s.curve === 'lin') param.linearRampToValueAtTime(s.value, t)
    else param.exponentialRampToValueAtTime(Math.max(s.value, GAIN_FLOOR), t)
  }
}

/**
 * Play what `schedule` planned, starting at `t0` on the context's clock.
 *
 * `buffers` supplies the decoded audio for `{ file }` sources; a file source
 * with nothing decoded for it is skipped rather than thrown, on the same
 * principle as `play()` — a missed sound is never worth an exception on the one
 * screen the whole room is watching.
 *
 * Returns a function that cuts it short. The board never calls it — a cue on
 * the board runs to its own end — but a preview you can start and not stop is
 * a preview that holds the room hostage to a three-second buzzer, so the
 * handle exists for the panel that needs it.
 */
export function render(
  ctx: AudioContext,
  voices: Voice[],
  t0: number,
  gain: number,
  buffers?: Map<string, AudioBuffer>,
): () => void {
  const started: (OscillatorNode | AudioBufferSourceNode)[] = []
  for (const v of voices) {
    let node: OscillatorNode | AudioBufferSourceNode
    if (typeof v.source === 'object') {
      const buf = buffers?.get(v.source.file)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      // Resampled like everything else, so the harness's slow motion slows a
      // file layer along with the oscillators beside it in the same cue.
      src.playbackRate.value = v.rate
      node = src
    } else if (v.source === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx)
      src.loop = true
      node = src
    } else {
      const osc = ctx.createOscillator()
      osc.type = v.source
      apply(osc.frequency, v.freq, t0)
      node = osc
    }

    const amp = ctx.createGain()
    amp.gain.setValueAtTime(GAIN_FLOOR, t0 + v.start)
    apply(amp.gain, v.gain, t0)

    let tail: AudioNode = amp
    if (v.filter) {
      const biq = ctx.createBiquadFilter()
      biq.type = v.filter.type
      biq.Q.value = v.filter.q
      apply(biq.frequency, v.filter.freq, t0)
      amp.connect(biq)
      tail = biq
    }

    const out = ctx.createGain()
    out.gain.value = gain
    node.connect(amp)
    tail.connect(out).connect(ctx.destination)

    if (node instanceof AudioBufferSourceNode) node.start(t0 + v.start, v.head)
    else node.start(t0 + v.start)
    node.stop(t0 + v.stop)
    started.push(node)
  }

  return () => {
    for (const node of started) {
      // A node whose scheduled stop has already passed throws on a second
      // stop in some engines, and a preview being cut short after it finished
      // on its own is the ordinary case, not an error.
      try {
        node.stop()
      } catch {}
    }
  }
}
