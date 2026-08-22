/**
 * One-shot sample playback for the anchor moments.
 *
 * A cue's numbers live with the cue: in `RECIPES` for anything that is a
 * recipe, in `BED` below for the one cue that is still a sample. Custom
 * properties in `anim:tunables` are the tempting alternative — aligning a sound
 * to a movement is the same act as tuning the movement, and it would buy the
 * harness's dials and write-back for free.
 *
 * A recipe layer already carries `gain`, `delay` and its own envelope, so
 * keeping a parallel set of the same numbers in a stylesheet meant two homes
 * for one value and a `head`/`cut` pair that the recipe path silently ignored.
 * The values moved to the recipe; the stylesheet went back to being about what
 * things look like. What is left in CSS is genuinely shared with the picture:
 * `--mark-stagger`, which the marks animate against and this file reads for
 * spacing.
 */

import { recipeFor } from './cues.ts'
import { onset, render, schedule, type Recipe } from './synth.ts'

export type Cue = 'stamp' | 'leader' | 'welcome' | 'type' | 'award' | 'penalty'

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
 * ponytail: one constant, linear, and only the bed's cut uses it now — every
 * other cue expresses its release as a `release` stage on a layer. If the bed
 * ever wants its own, it becomes a field on `BED`.
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
 * that is still a sample needs its own buffer instead. Callers pass cue names
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
 * Every CSS tunable the JavaScript reads, and what it falls back to.
 *
 * The values live in `anim:tunables` in `client/style.css`, which is what the
 * motion harness writes to — but a property the DOM cannot answer for needs a
 * number anyway, and a fallback restated at each call site is a second copy of
 * the value in a file the harness never touches. Two of the four had already
 * drifted from the stylesheet by the time this table replaced them. Here there
 * is one copy per tunable and `client/tunables.test.ts` fails when it stops
 * matching the CSS.
 *
 * Times in ms, because that is what every caller schedules in.
 */
export const TUNE = {
  '--mark-stagger': 100,
  '--type-chunk': 120,
  '--verdict-hold': 500,
  '--penalty-dwell': 2200,
} as const

export type Tunable = keyof typeof TUNE

/**
 * One tunable, read from wherever the properties live.
 *
 * `scope` is the element to read from, and it matters: the harness applies
 * dialled values to its stage wrapper, so a component reading from
 * `document.documentElement` never sees them. Pass your own element.
 */
export function tune(name: Tunable, scope?: Element): number {
  return parseTune(
    getComputedStyle(scope ?? document.documentElement).getPropertyValue(name),
    TUNE[name],
  )
}

/**
 * The parse itself, split out because it is arithmetic and the read is DOM.
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

/**
 * The bed's numbers, for the one cue that is not a recipe.
 *
 * `welcome` is a minute and a half of music that runs rather than a sound that
 * fires: it loops, and `head`/`cut` are its loop points rather than a trim, so
 * it stays on the sample path until the synth learns to loop. Its four numbers
 * live here because a recipe is where the others live and this cue has none —
 * not in a stylesheet, which is the arrangement the rest of this file just got
 * out of.
 */
const BED = { gain: 0.35, head: 0, cut: 0, rate: 1 }

export type PlayOpts = {
  /** Multiplies the rate, so slow motion can slow the sound with it. */
  rateScale?: number
  /** Offsets the start, for spacing one cue out of a cluster. */
  offsetMs?: number
  /** The harness's dialled recipe, standing in for the committed one. */
  recipe?: Recipe
}

/**
 * Fire a cue. Silent and harmless before the context is unlocked or the buffer
 * has landed — a missed sound is never worth a thrown exception on the one
 * screen the whole room is watching.
 */
/**
 * Fire a recipe directly, and hand back the way to cut it short.
 *
 * The recipe branch of `play()` and every preview in the panel are the same
 * act — a list of layers, rendered once — so they are one function. A preview
 * calls this with a recipe that is not a cue and may never become one.
 *
 * Everything the recipe needs is in the recipe: each layer's own `gain` is its
 * level and each layer's own `delay` is its offset, both applied by `schedule`.
 * The render gain is therefore a plain 1 rather than a second volume control
 * stacked on top of the layers'.
 */
export function playRecipe(recipe: Recipe, rateScale = 1, offsetMs = 0): () => void {
  const ac = unlock()
  const t0 = Math.max(ac.currentTime, ac.currentTime + offsetMs / 1000)
  const stop = render(ac, schedule(recipe, Math.max(0.05, rateScale)), t0, 1, files)
  // `render` skips a file layer with nothing decoded for it, so start the
  // decode and let the next trigger have it. One silent cue, not a silent night.
  for (const l of recipe)
    if (typeof l.source === 'object' && !files.has(l.source.file)) void primeFile(l.source.file)
  return stop
}

/**
 * The harness's dialled recipes, standing in for the committed ones. A cue a
 * component fires itself (Spoken's per-chunk tap) takes no recipe argument,
 * so this is how its sound follows the panel. Null outside the harness.
 */
let dialled: Record<string, Recipe> | null = null
export function setDialled(recipes: Record<string, Recipe> | null): void {
  dialled = recipes
}

export function play(cue: Cue, { rateScale = 1, offsetMs = 0, recipe }: PlayOpts = {}): void {
  const r = recipe ?? dialled?.[cue] ?? recipeFor(cue)
  if (r) {
    playRecipe(r, rateScale, offsetMs)
    return
  }

  const buf = buffers.get(cue)
  if (!buf) {
    void load(cue).catch(() => {})
    return
  }
  const ac = unlock()
  const { head, cut, gain } = BED
  const rate = BED.rate * rateScale

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

  const t0 = Math.max(ac.currentTime, ac.currentTime + offsetMs / 1000)
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
  return tune('--mark-stagger', scope)
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
  cues.forEach((c, i) => play(c, { offsetMs: plan.offsets[i] }))
}

/* --- the bed -----------------------------------------------------------
   A cue that runs rather than fires, and the last one still reading `BED`:
   `head` and `cut` are its loop points rather than a trim, so a file with
   applause on the tail can be looped on its good bars alone. */

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
export function startBed(cue: Cue): void {
  if (bed?.cue === cue) return
  wanted = cue
  const buf = buffers.get(cue)
  if (!buf) {
    // Come back once it has decoded — unless the moment has passed by then.
    void load(cue)
      .then(() => wanted === cue && startBed(cue))
      .catch(() => {})
    return
  }
  stopBed()
  wanted = cue

  const ac = unlock()
  const { gain } = BED
  const head = BED.head / 1000
  const cut = BED.cut / 1000

  const src = ac.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.loopStart = Math.max(0, head)
  src.loopEnd = cut > head ? cut : buf.duration
  src.playbackRate.value = Math.max(0.05, BED.rate)

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
