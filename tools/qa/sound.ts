/**
 * What a cue sounds like, as numbers, for a critic who cannot hear it.
 *
 *   node tools/qa/sound.ts               # every cue
 *   node tools/qa/sound.ts poker-deal    # cues whose name contains a word
 *
 * Renders each recipe with `tools/loudness.ts` and reports:
 * - loudness against its tier in the standard;
 * - shape: onset, attack (to 90% of the envelope's peak), how long it lasts,
 *   and how much of that it spends within 10dB of its peak (`held`: a short
 *   hit is near 0; a held, steady noise is the TV-static shape);
 * - spectrum: energy share per band, centroid, and flatness (1 is white
 *   noise, near 0 a pure tone);
 * - `phone`: the share of energy above 400Hz, which is roughly what a phone
 *   speaker can play at all. Below about 30% a cue is mostly inaudible there.
 */
import { RECIPES } from '../../client/cues.ts'
import type { Recipe } from '../../client/synth.ts'
import { STANDARD, TIERS, measure, render } from '../loudness.ts'

const RATE = 48_000
const BANDS = [[0, 120, 'sub'], [120, 400, 'low'], [400, 2000, 'mid'], [2000, 5000, 'presence'], [5000, 24000, 'air']] as const

/** Power spectrum of `x`, zero-padded to a power of two. */
function power(x: Float32Array): Float64Array {
  let n = 1
  while (n < x.length) n <<= 1
  const re = new Float64Array(n), im = new Float64Array(n)
  re.set(x)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k)
      const p = i + k, q = p + len / 2
      const tr = re[q] * c - im[q] * s, ti = re[q] * s + im[q] * c
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti
    }
  }
  const out = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) out[i] = re[i] ** 2 + im[i] ** 2
  return out
}

export function character(samples: Float32Array) {
  const win = RATE / 200
  const env: number[] = []
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0
    for (let j = i; j < Math.min(samples.length, i + win); j++) sum += samples[j] ** 2
    env.push(Math.sqrt(sum / win))
  }
  const peak = Math.max(...env, 1e-12)
  const ms = (i: number) => i * 5
  const onset = env.findIndex((e) => e > peak * 0.01)
  const end = env.length - 1 - [...env].reverse().findIndex((e) => e > peak * 0.001)
  const attack = env.findIndex((e) => e >= peak * 0.9) - onset
  const held = env.slice(onset, end + 1).filter((e) => e > peak / Math.sqrt(10)).length / Math.max(1, end - onset + 1)

  const spec = power(samples)
  const hz = (i: number) => (i * RATE) / (2 * spec.length)
  let total = 0, weighted = 0, logSum = 0, count = 0, linSum = 0
  const bands = BANDS.map(() => 0)
  for (let i = 1; i < spec.length; i++) {
    const f = hz(i), p = spec[i]
    total += p
    weighted += p * f
    bands[BANDS.findIndex(([lo, hi]) => f >= lo && f < hi)] += p
    if (f >= 100 && f <= 8000) { logSum += Math.log(p + 1e-30); linSum += p; count++ }
  }
  const share = (k: number) => bands[k] / (total || 1)
  return {
    onsetMs: ms(Math.max(0, onset)),
    attackMs: ms(Math.max(0, attack)),
    lengthMs: ms(Math.max(0, end - onset)),
    held,
    centroidHz: weighted / (total || 1),
    flatness: Math.exp(logSum / count) / (linSum / count || 1),
    phone: share(2) + share(3) + share(4),
    bands: Object.fromEntries(BANDS.map(([, , name], k) => [name, share(k)])),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const words = process.argv.slice(2)
  const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4)
  for (const [cue, recipe] of Object.entries(RECIPES as Record<string, Recipe>)) {
    if (words.length && !words.some((w) => cue.includes(w))) continue
    const samples = render(recipe)
    const { lufs, peak } = measure(samples)
    const c = character(samples)
    const tier = STANDARD[cue] ?? 'no tier'
    const target = tier in TIERS ? TIERS[tier as keyof typeof TIERS] : null
    console.log(`${cue.padEnd(15)} ${lufs.toFixed(1).padStart(6)} LUFS (${tier}${target === null ? '' : ` ${target}`}) peak ${peak.toFixed(1)}dBFS | onset ${c.onsetMs}ms attack ${c.attackMs}ms length ${c.lengthMs}ms held ${pct(c.held)} | centroid ${Math.round(c.centroidHz)}Hz flatness ${c.flatness.toFixed(2)} phone ${pct(c.phone)} | ${Object.entries(c.bands).map(([k, v]) => `${k} ${pct(v)}`).join(' ')}`)
  }
}
