/**
 * How loud each cue is, measured rather than guessed.
 *
 *   npm run loudness           # every cue against the standard; fails if one is off
 *   npm run loudness -- --apply   # scale each off-standard cue's gains onto it
 *
 * Renders each recipe offline the way `synth.ts` plays it (source → envelope →
 * biquad, WebAudio's own filter formulas), then K-weights it as BS.1770 does
 * and reports the loudest 100ms window in LUFS. 100ms rather than the
 * standard's 400ms because most cues are shorter than 400ms, and a window
 * longer than the sound averages silence into it.
 *
 * ponytail: oscillators are naive (not band-limited) and filters update once
 * per 128-sample block like WebAudio's k-rate path. Close enough to rank and
 * level cues to a dB or so; not a mastering meter.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RECIPES } from '../client/cues.ts'
import { schedule, GAIN_FLOOR, type Recipe, type Step } from '../client/synth.ts'
import { mulberry32 } from '../shared/random.ts'

/**
 * The standard: every cue sits on one of five tiers, each 6dB (twice as loud)
 * or so above the next, measured as the loudest 100ms on the board.
 *
 * The tiers are set by the hand-tuned anchors: `award`/`penalty` are the hero
 * tier, `stamp` the signal tier and `type` the foley tier. A cue that should
 * be quieter on a phone, which is held a foot from the ear, is played there
 * with `gain`, not given a second recipe.
 */
export const TIERS = { hero: -14, event: -20, signal: -26, foley: -32, air: -40 } as const
export const STANDARD: Record<string, keyof typeof TIERS | 'exempt'> = {
  // Anchors: hand-tuned files and recipes, never rescaled.
  leader: 'exempt', stamp: 'exempt', type: 'exempt', award: 'exempt', penalty: 'exempt',
  // Tuned by ear on the phone to be barely there; its gain carries the phone's 6dB back.
  'poker-puft': 'exempt',
  // A verdict that changes the game.
  'sketch-over': 'event', 'sketch-right': 'event', 'sketch-all': 'event', 'sketch-timeup': 'event',
  'poker-win': 'event', 'poker-allin': 'event', 'poker-bust': 'event', 'poker-level': 'event', 'poker-drumroll': 'event',
  // Something the room should notice.
  'sketch-turn': 'signal', 'sketch-yours': 'signal', 'sketch-got': 'signal', 'sketch-close': 'signal', 'sketch-go': 'signal',
  'sketch-pass': 'signal', 'sketch-hint': 'signal', 'sketch-miss': 'signal',
  'poker-check': 'signal', 'poker-auto': 'signal', 'poker-puck': 'signal', 'poker-react': 'signal', 'poker-nope': 'signal',
  // The table's own small sounds.
  'sketch-tick': 'foley', 'poker-tick': 'foley', 'poker-chips': 'foley', 'poker-push': 'foley', 'poker-sweep': 'foley',
  'poker-tap': 'foley', 'poker-poof': 'foley', 'poker-detent': 'foley',
  // Cards moving through air.
  'poker-deal': 'air', 'poker-fold': 'air', 'poker-flip': 'air',
}
/** How far off its tier a cue may sit before the check fails, dB. Noise renders vary by about ±0.5. */
const SLACK = 1.5

const RATE = 48_000
const PUBLIC = fileURLToPath(new URL('../client/public', import.meta.url))

/** An AudioParam's value at `t`, from the steps `schedule` wrote. */
export function paramAt(steps: Step[], t: number, initial = GAIN_FLOOR): number {
  let value = initial, at = 0
  for (const s of steps) {
    if (s.t > t) {
      if (s.curve === 'lin') return value + (s.value - value) * ((t - at) / (s.t - at))
      if (s.curve === 'exp') return value * (Math.max(s.value, GAIN_FLOOR) / value) ** ((t - at) / (s.t - at))
      return value
    }
    value = s.value
    at = s.t
  }
  return value
}

const files = new Map<string, Float32Array>()
function decode(url: string): Float32Array {
  let data = files.get(url)
  if (!data) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `${PUBLIC}${url}`, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 })
    data = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    files.set(url, data)
  }
  return data
}

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number }
/** WebAudio's biquad coefficients: lowpass/highpass Q is in dB, bandpass Q is linear. */
function coefficients(type: BiquadFilterType, freq: number, q: number): Biquad {
  const w = 2 * Math.PI * Math.min(freq, RATE / 2 - 1) / RATE
  const cos = Math.cos(w), sin = Math.sin(w)
  let b0: number, b1: number, b2: number
  const alpha = type === 'bandpass' ? sin / (2 * Math.max(q, 1e-4)) : sin / (2 * 10 ** (q / 20))
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0 }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0 }
  else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha }
  else throw new Error(`no meter for a ${type} filter`)
  const a0 = 1 + alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cos / a0, a2: (1 - alpha) / a0 }
}

/** A cue as samples. */
export function render(recipe: Recipe, seed = 1): Float32Array {
  const random = mulberry32(seed)
  const voices = schedule(recipe)
  const out = new Float32Array(Math.ceil(Math.max(...voices.map((v) => v.stop)) * RATE) + 1)
  for (const v of voices) {
    const from = Math.floor(v.start * RATE), to = Math.min(out.length, Math.ceil(v.stop * RATE))
    const file = typeof v.source === 'object' ? decode(v.source.file) : null
    let phase = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0
    let c: Biquad | null = null
    for (let i = from; i < to; i++) {
      const t = i / RATE
      let s: number
      if (file) s = file[Math.floor((v.head + (t - v.start) * v.rate) * RATE)] ?? 0
      else if (v.source === 'noise') s = random() * 2 - 1
      else {
        phase = (phase + paramAt(v.freq, t, 440) / RATE) % 1
        s = v.source === 'sine' ? Math.sin(2 * Math.PI * phase)
          : v.source === 'square' ? (phase < 0.5 ? 1 : -1)
          : v.source === 'sawtooth' ? 2 * phase - 1
          : 1 - 4 * Math.abs(phase - 0.5)
      }
      s *= paramAt(v.gain, t)
      if (v.filter) {
        if ((i - from) % 128 === 0) c = coefficients(v.filter.type, paramAt(v.filter.freq, t, 350), v.filter.q)
        const y = c!.b0 * s + c!.b1 * x1 + c!.b2 * x2 - c!.a1 * y1 - c!.a2 * y2
        x2 = x1; x1 = s; y2 = y1; y1 = y
        s = y
      }
      out[i] += s
    }
  }
  return out
}

/** BS.1770's K-weighting at 48kHz: the head's high shelf, then the low cut. */
function kWeight(x: Float32Array): Float32Array {
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
    { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
  ]
  let y = x
  for (const { b, a } of stages) {
    const out = new Float32Array(y.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) {
      const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v
      out[i] = v
    }
    y = out
  }
  return y
}

/**
 * A cue's level as the room hears it across plays: noise differs every time,
 * so this is the median over a fixed set of seeds. Fixed, so the same cue
 * always measures the same and a check near a tier's edge cannot flip.
 */
export function level(recipe: Recipe): { lufs: number; peak: number } {
  return [1, 2, 3, 4, 5, 6, 7].map((seed) => measure(render(recipe, seed))).sort((a, b) => a.lufs - b.lufs)[3]
}

/** The loudest 100ms window, K-weighted, in LUFS; and the sample peak in dBFS. */
export function measure(samples: Float32Array): { lufs: number; peak: number } {
  const k = kWeight(samples)
  const win = RATE / 10, hop = RATE / 100
  let loudest = 1e-12
  for (let i = 0; i < Math.max(1, k.length - win); i += hop) {
    let sum = 0
    for (let j = i; j < Math.min(k.length, i + win); j++) sum += k[j] * k[j]
    loudest = Math.max(loudest, sum / win)
  }
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 1e-12)
  return { lufs: -0.691 + 10 * Math.log10(loudest), peak: 20 * Math.log10(peak) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes('--apply')
  const CUES = fileURLToPath(new URL('../client/cues.ts', import.meta.url))
  let source = readFileSync(CUES, 'utf8')
  let off = 0
  for (const [cue, recipe] of Object.entries(RECIPES as Record<string, Recipe>)) {
    const { lufs, peak } = level(recipe)
    const tier = STANDARD[cue]
    const target = tier && tier !== 'exempt' ? TIERS[tier] : null
    const delta = target === null ? 0 : target - lufs
    const bad = !tier || Math.abs(delta) > SLACK
    if (bad) off++
    console.log(`${bad ? '✗' : ' '} ${cue.padEnd(16)} ${(tier ?? 'no tier').padEnd(7)} ${lufs.toFixed(1).padStart(6)} LUFS  ${target === null ? '' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} dB`.padEnd(9)} peak ${peak.toFixed(1)} dBFS`)
    if (!apply || target === null || !bad) continue
    // A cue written on one line is rewritten on one line; the anchors span several and are exempt.
    const line = new RegExp(`^  "${cue}": (\\[.*\\]),$`, 'm')
    const m = source.match(line)
    if (!m) { console.log(`  cannot rescale ${cue}: not a one-line recipe`); continue }
    const scale = 10 ** (delta / 20)
    const layers = (JSON.parse(m[1]) as Recipe).map((l) => ({ ...l, gain: Number(((l.gain ?? 1) * scale).toPrecision(3)) }))
    source = source.replace(line, `  "${cue}": ${JSON.stringify(layers).replace(/,"/g, ', "').replace(/":/g, '": ')},`)
  }
  if (apply) writeFileSync(CUES, source)
  else if (off) { console.log(`${off} cue(s) off the standard`); process.exitCode = 1 }
}
