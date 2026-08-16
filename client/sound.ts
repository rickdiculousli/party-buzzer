/**
 * One-shot sample playback for the anchor moments.
 *
 * The numbers live in the `anim:tunables` block in style.css alongside the
 * visual ones, as ordinary custom properties. Nothing reads them from CSS —
 * `tune()` below does, through `getComputedStyle`. They are there because
 * aligning a sound to a movement is the same act as tuning the movement, and
 * because it means the harness's dials, origin markers and write-back all work
 * on sound without knowing anything about it.
 *
 * That is also why `play()` takes a scope element: the harness sets the
 * properties on its own wrapper rather than on `:root`, so a player that read
 * only from the document would hear the file's committed values while you
 * watched the dialled ones.
 */

import { recipeFor } from './cues.ts'
import { onset, render, schedule, type Recipe } from './synth.ts'

export type Cue = 'stamp' | 'leader' | 'welcome'

/**
 * The sample path's files. A cue that is a recipe names its files in its
 * layers instead and never appears here — `leader.wav` and `leader2.wav` are
 * both layers of the one `leader` cue, which is why neither is listed.
 */
const FILES: Partial<Record<Cue, string>> = {
  stamp: '/sounds/stamp.wav',
  leader: '/sounds/leader.wav',
  welcome: '/sounds/welcome.ogg',
}

/**
 * How long the cut takes to fall silent. Chopping a sample dead mid-waveform
 * is a click, and a click is louder than the sound it ends.
 *
 * ponytail: one constant for every cue, and linear. If a cue ever needs its own
 * release shape, it becomes a `--<cue>-snd-release` beside the others.
 */
const RELEASE_MS = 40

let ctx: AudioContext | null = null
const buffers = new Map<Cue, AudioBuffer>()
const loading = new Map<Cue, Promise<AudioBuffer>>()

/**
 * Bring the audio context up. Must be called inside a user gesture the first
 * time, and again after a resume — a context suspended by a locked laptop lid
 * stays suspended, and every later `play()` would be silent without a sound.
 */
export function unlock(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/**
 * Fetched and decoded on first use, not on load. The welcome bed is a minute
 * and a half long; a phone that will never play it should never pay for it.
 */
function load(cue: Cue): Promise<AudioBuffer> {
  const held = loading.get(cue)
  if (held) return held
  const url = FILES[cue]
  if (!url) return Promise.reject(new Error(`${cue} has no file`))
  const job = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => unlock().decodeAudioData(b))
    .then((buf) => {
      buffers.set(cue, buf)
      return buf
    })
  loading.set(cue, job)
  return job
}

/**
 * Decode ahead of time, so the first play is not late by a decode.
 *
 * A cue that is a recipe needs the bytes each of its `{ file }` layers names,
 * keyed by URL, because that is the map `render` looks in — priming the sample
 * buffer for such a cue fills the wrong map and the cue plays silently. A cue
 * that is still a sample needs its own buffer as before. Callers pass cue names
 * either way and never have to know which kind they got.
 */
export function prime(...cues: Cue[]): void {
  for (const c of cues) {
    const r = recipeFor(c)
    if (!r) {
      void load(c).catch(() => {})
      continue
    }
    for (const l of r) if (typeof l.source === 'object') void primeFile(l.source.file)
  }
}

/** Decoded raw/adopted files, keyed by the path a `{ file }` layer names. */
const files = new Map<string, AudioBuffer>()

/** Decode a file so a `{ file }` layer can use it. Idempotent. */
export function primeFile(url: string): Promise<void> {
  if (files.has(url)) return Promise.resolve()
  return fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => unlock().decodeAudioData(b))
    .then((buf) => void files.set(url, buf))
    .catch(() => {})
}

/**
 * The decoded bytes behind a `{ file }` layer, for anything that needs to look
 * at the audio rather than play it — which today is the harness drawing a
 * waveform. Nothing is fetched: this reads what `primeFile` already landed, and
 * a miss means the decode has not finished, which the caller draws as an empty
 * track rather than waiting on.
 */
export function bufferFor(url: string): AudioBuffer | undefined {
  return files.get(url)
}

/**
 * One tunable, read from wherever the caller says the properties live.
 *
 * Times come back in whatever unit survived the build, which is not the unit
 * that was written: the CSS minifier rewrites `1000ms` as the shorter and
 * exactly equivalent `1s`. A bare `parseFloat` then reads 1, and a sound cut at
 * a second is cut at a millisecond instead — silence in production, correct in
 * dev, which is the worst shape a bug can have. Unitless dials (rate, gain) are
 * unaffected and take the same path.
 */
export function parseTune(raw: string, fallback: number): number {
  const v = raw.trim()
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return fallback
  return /[^m]s$/.test(v) ? n * 1000 : n
}

function tune(scope: Element, cue: Cue, key: string, fallback: number): number {
  return parseTune(getComputedStyle(scope).getPropertyValue(`--${cue}-snd-${key}`), fallback)
}

export type PlayOpts = {
  /** Where the tunables are read from. The harness passes its own wrapper. */
  scope?: Element
  /** Multiplies the tuned rate, so slow motion can slow the sound with it. */
  rateScale?: number
  /** Pushed on top of the tuned delay, for spacing one cue out of a cluster. */
  offsetMs?: number
  /** The harness's dialled recipe, standing in for the committed one. */
  recipe?: Recipe
}

/**
 * Fire a cue. Silent and harmless before the context is unlocked or the buffer
 * has landed — a missed sound is never worth a thrown exception on the one
 * screen the whole room is watching.
 */
export function play(
  cue: Cue,
  { scope, rateScale = 1, offsetMs = 0, recipe }: PlayOpts = {},
): void {
  const r = recipe ?? recipeFor(cue)
  if (r) {
    const ac = unlock()
    const at = scope ?? document.documentElement
    const delay = tune(at, cue, 'delay', 0)
    const rate = tune(at, cue, 'rate', 1) * rateScale
    const gain = tune(at, cue, 'gain', 1)
    // A recipe's length is its envelopes, so `head` and `cut` stay sample-only.
    // Clamped to now for the same reason the sample path is: a start in the
    // past is played immediately, which is late but never silent.
    const t0 = Math.max(ac.currentTime, ac.currentTime + (delay + offsetMs) / 1000)
    render(ac, schedule(r, Math.max(0.05, rate)), t0, gain, files)
    // The same self-heal the sample path below has: `render` skips a file layer
    // with nothing decoded for it, so start the decode and let the next trigger
    // have it. One silent cue, not a silent night.
    for (const l of r)
      if (typeof l.source === 'object' && !files.has(l.source.file)) void primeFile(l.source.file)
    return
  }

  const buf = buffers.get(cue)
  if (!buf) {
    void load(cue).catch(() => {})
    return
  }
  const ac = unlock()
  const at = scope ?? document.documentElement

  const delay = tune(at, cue, 'delay', 0)
  const head = tune(at, cue, 'head', 0)
  const cut = tune(at, cue, 'cut', 0)
  const rate = tune(at, cue, 'rate', 1) * rateScale
  const gain = tune(at, cue, 'gain', 1)

  const src = ac.createBufferSource()
  src.buffer = buf
  // Speed and pitch are the same control here: this resamples, so 2x is an
  // octave up and half the length. Separating them means time-stretching, which
  // is a phase vocoder and a real dependency. If a cue ever genuinely needs one
  // without the other, bake it into the file with ffmpeg — `atempo` changes
  // length at pitch, `asetrate` changes pitch at length — and leave this a
  // single honest knob.
  src.playbackRate.value = Math.max(0.05, rate)

  const amp = ac.createGain()
  amp.gain.value = gain
  src.connect(amp).connect(ac.destination)

  const t0 = Math.max(ac.currentTime, ac.currentTime + (delay + offsetMs) / 1000)
  src.start(t0, Math.max(0, head / 1000))

  // `cut` is wall-clock output, not a length of the file, so it means the same
  // thing whatever the rate is doing.
  if (cut > 0) {
    const end = t0 + cut / 1000
    amp.gain.setValueAtTime(gain, end)
    amp.gain.linearRampToValueAtTime(0, end + RELEASE_MS / 1000)
    src.stop(end + RELEASE_MS / 1000)
  }
}

/**
 * The closest two marks may land, in either sense.
 *
 * The board reads it for scheduling and the marks animate against it, so the
 * picture and the sound cannot drift apart.
 */
export function markGap(scope?: Element): number {
  return parseTune(
    getComputedStyle(scope ?? document.documentElement).getPropertyValue('--mark-stagger'),
    70,
  )
}

/**
 * The next instant a cue is allowed to sound, on the audio clock.
 *
 * Never reset. Whether the queue is busy or has been quiet for a minute, this
 * is the one place that knows when something last actually played — and the
 * only clock that does. The board's own queue runs on `performance.now()` at
 * render time, but a cue is scheduled later, from an effect, against a context
 * whose time has moved on since. Two arrivals the render queue believed were
 * spaced could still have their effects run back to back and stack up.
 */
let nextFree = 0

/**
 * Where each cue of one moment starts, in ms from now.
 *
 * Slots are spaced by when a cue is *heard*, not when it starts, because the
 * ear times a sound by its attack. A cue with a 120ms onset therefore starts
 * 120ms before its slot so that its attack lands on it. `delay` is untouched by
 * any of this and keeps its full power to reorder: `delay` is an offset you
 * asked for, `onset` is latency you did not.
 *
 * Pure so it can be checked without a browser — the audio clock is the caller's
 * problem.
 */
export function spacedPlan(
  now: number,
  free: number,
  gap: number,
  onsets: number[],
): { free: number; offsets: number[] } {
  const heard = Math.max(now, free)
  return {
    free: heard + gap,
    // A cue whose onset is longer than the lead available cannot start in the
    // past, so it is late instead. Which is what it would have been anyway.
    offsets: onsets.map((o) => Math.max(0, heard - o - now)),
  }
}

/**
 * Fire a cue, never sooner than a gap after the last one.
 *
 * Several cues given together are one moment, not several: they share the slot
 * and cost one gap between them. Each still has its own `delay`, which is how
 * two layers of the same moment are moved against each other.
 *
 * Returns nothing to align a picture against on purpose: the caller schedules
 * its own visuals in its own clock. What is shared is the gap, not the moment.
 */
export function playSpaced(cue: Cue | Cue[], scope?: Element): void {
  const ac = unlock()
  const cues = [cue].flat()
  const now = ac.currentTime * 1000
  const plan = spacedPlan(
    now,
    nextFree * 1000,
    markGap(scope),
    cues.map((c) => onset(recipeFor(c) ?? [])),
  )
  nextFree = plan.free / 1000
  cues.forEach((c, i) => play(c, { scope, offsetMs: plan.offsets[i] }))
}

/* --- the bed -----------------------------------------------------------
   A cue that runs rather than fires. Same tunables, read once at the start
   because there is no later trigger to re-read them on: `head` and `cut`
   become the loop points, so a file with applause on the tail can be looped
   on its good bars alone. */

let bed: { cue: Cue; amp: GainNode; src: AudioBufferSourceNode } | null = null
/**
 * What the caller last asked for, which is not the same as what is playing.
 * A 17MB bed takes a moment to decode, and by the time it lands the lobby may
 * be over — starting then would be music arriving to an empty welcome screen.
 */
let wanted: Cue | null = null

/** How long the bed takes to arrive, and to leave. Long: this is music. */
const FADE_MS = 900

/**
 * Start the looping bed, or leave it alone if it is already the one playing.
 *
 * Idempotent on purpose — the board calls this from a render path that runs on
 * every broadcast, and a bed that restarted on each one would stutter all the
 * way through the lobby.
 */
export function startBed(cue: Cue, scope?: Element): void {
  if (bed?.cue === cue) return
  wanted = cue
  const buf = buffers.get(cue)
  if (!buf) {
    // Come back once it has decoded — unless the moment has passed by then.
    void load(cue)
      .then(() => wanted === cue && startBed(cue, scope))
      .catch(() => {})
    return
  }
  stopBed()
  wanted = cue

  const ac = unlock()
  const at = scope ?? document.documentElement
  const gain = tune(at, cue, 'gain', 0.5)
  const head = tune(at, cue, 'head', 0) / 1000
  const cut = tune(at, cue, 'cut', 0) / 1000

  const src = ac.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.loopStart = Math.max(0, head)
  src.loopEnd = cut > head ? cut : buf.duration
  src.playbackRate.value = Math.max(0.05, tune(at, cue, 'rate', 1))

  const amp = ac.createGain()
  amp.gain.setValueAtTime(0, ac.currentTime)
  amp.gain.linearRampToValueAtTime(gain, ac.currentTime + FADE_MS / 1000)
  src.connect(amp).connect(ac.destination)
  src.start(ac.currentTime, src.loopStart)

  bed = { cue, amp, src }
}

/** Fade the bed out and let it go. Safe to call when nothing is playing. */
export function stopBed(): void {
  wanted = null
  if (!bed) return
  const { amp, src } = bed
  bed = null
  const ac = unlock()
  const end = ac.currentTime + FADE_MS / 1000
  // From wherever it actually is, so stopping mid-fade-in does not jump loud.
  amp.gain.cancelScheduledValues(ac.currentTime)
  amp.gain.setValueAtTime(amp.gain.value, ac.currentTime)
  amp.gain.linearRampToValueAtTime(0, end)
  src.stop(end)
}
