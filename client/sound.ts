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

export type Cue = 'stamp' | 'leader' | 'leader2' | 'welcome'

const FILES: Partial<Record<Cue, string>> = {
  stamp: '/sounds/stamp.wav',
  leader: '/sounds/leader.wav',
  leader2: '/sounds/leader2.wav',
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

/** Decode ahead of time, so the first play is not late by a decode. */
export function prime(...cues: Cue[]): void {
  for (const c of cues) void load(c).catch(() => {})
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
    render(ac, schedule(r, Math.max(0.05, rate)), t0, gain)
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
  const at = Math.max(ac.currentTime, nextFree)
  nextFree = at + markGap(scope) / 1000
  const offsetMs = (at - ac.currentTime) * 1000
  for (const c of [cue].flat()) play(c, { scope, offsetMs })
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
