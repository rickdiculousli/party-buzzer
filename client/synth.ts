export type Source =
  | 'sine' | 'square' | 'sawtooth' | 'triangle'
  | 'noise'
  | { file: string }

export type Layer = {
  source: Source
  freq?: number
  freqTo?: number
  glide?: 'lin' | 'exp'

  attack?: number
  decay?: number
  level?: number
  sustain?: number
  release?: number

  gain?: number
  delay?: number
  head?: number

  filter?: { type: BiquadFilterType; freq: number; freqTo?: number; q?: number }
}

export type Recipe = Layer[]

export type Step = { t: number; value: number; curve: 'set' | 'lin' | 'exp' }
export type Voice = {
  source: Source
  start: number
  stop: number
  head: number
  rate: number
  freq: Step[]
  gain: Step[]
  filter?: { type: BiquadFilterType; q: number; freq: Step[] }
}

export const GAIN_FLOOR = 1e-4

const ms = (v: number | undefined, rate: number) => (v ?? 0) / 1000 / rate

export function schedule(recipe: Recipe, rate = 1): Voice[] {
  const r = Math.max(0.05, rate)
  return recipe.map((l) => {
    const start = ms(l.delay, r)
    const attack = ms(l.attack, r)
    const decay = ms(l.decay, r)
    const sustain = ms(l.sustain, r)
    const release = ms(l.release, r)
    const stop = start + ms((l.attack ?? 0) + (l.decay ?? 0) + (l.sustain ?? 0) + (l.release ?? 0), r)

    const peak = Math.max(l.gain ?? 1, GAIN_FLOOR)
    const level = Math.max(peak * (l.level ?? 0), GAIN_FLOOR)

    const gain: Step[] = [{ t: start, value: GAIN_FLOOR, curve: 'set' }]
    const at = (t: number, value: number, curve: Step['curve']) => gain.push({ t, value, curve })
    at(start + attack, peak, 'lin')
    at(start + attack + decay, level, 'exp')
    at(start + attack + decay + sustain, level, 'set')
    at(stop, GAIN_FLOOR, 'exp')

    const freq: Step[] = []
    if (l.freq !== undefined) {
      const exp = l.freqTo !== undefined && l.glide === 'exp'
      freq.push({ t: start, value: exp ? Math.max(l.freq * r, GAIN_FLOOR) : l.freq * r, curve: 'set' })
      if (l.freqTo !== undefined)
        freq.push({ t: stop, value: l.freqTo * r, curve: exp ? 'exp' : 'lin' })
    }

    const f = l.filter
    const filter = f && {
      type: f.type,
      q: f.q ?? 1,
      freq: [
        { t: start, value: Math.max(f.freq * r, GAIN_FLOOR), curve: 'set' as const },
        ...(f.freqTo === undefined
          ? []
          : [{ t: stop, value: f.freqTo * r, curve: 'exp' as const }]),
      ],
    }

    return { source: l.source, start, stop, head: (l.head ?? 0) / 1000, rate: r, freq, gain, filter }
  })
}

export function onset(r: Recipe): number {
  return r.length ? Math.min(...r.map((l) => (l.delay ?? 0) + (l.attack ?? 0))) : 0
}

let noise: AudioBuffer | null = null

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
      try {
        node.stop()
      } catch {}
    }
  }
}
