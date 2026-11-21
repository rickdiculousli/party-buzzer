import { recipeFor } from './cues.ts'
import { onset, render, schedule, type Recipe } from './synth.ts'

export type Cue = 'stamp' | 'leader' | 'welcome' | 'type' | 'award' | 'penalty'
  | 'sketch-turn' | 'sketch-yours' | 'sketch-go' | 'sketch-miss' | 'sketch-close' | 'sketch-got'
  | 'sketch-right' | 'sketch-hint' | 'sketch-tick' | 'sketch-all' | 'sketch-timeup' | 'sketch-pass' | 'sketch-over'
  | 'poker-deal' | 'poker-tap' | 'poker-flip' | 'poker-chips' | 'poker-sweep' | 'poker-push' | 'poker-fold' | 'poker-poof' | 'poker-puft' | 'poker-check' | 'poker-allin' | 'poker-drumroll' | 'poker-win' | 'poker-bust' | 'poker-level' | 'poker-tick' | 'poker-auto' | 'poker-nope' | 'poker-detent' | 'poker-react' | 'poker-puck'

const FILES: Partial<Record<Cue, string>> = {
  stamp: '/sounds/stamp.wav',
  leader: '/sounds/leader.wav',
  welcome: '/sounds/welcome.ogg',
}

const RELEASE_MS = 40

let ctx: AudioContext | null = null
const buffers = new Map<Cue, AudioBuffer>()
const loading = new Map<Cue, Promise<AudioBuffer>>()

export function unlock(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

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

const files = new Map<string, AudioBuffer>()

export function primeFile(url: string): Promise<void> {
  if (files.has(url)) return Promise.resolve()
  return fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => unlock().decodeAudioData(b))
    .then((buf) => void files.set(url, buf))
    .catch(() => {})
}

export function bufferFor(url: string): AudioBuffer | undefined {
  return files.get(url)
}

export const TUNE = {
  '--mark-stagger': 100,
  '--type-chunk': 120,
  '--verdict-hold': 500,
  '--penalty-dwell': 2200,
} as const

export type Tunable = keyof typeof TUNE

export function tune(name: Tunable, scope?: Element): number {
  return parseTune(
    getComputedStyle(scope ?? document.documentElement).getPropertyValue(name),
    TUNE[name],
  )
}

export function parseTune(raw: string, fallback: number): number {
  const v = raw.trim()
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return fallback
  return /[^m]s$/.test(v) ? n * 1000 : n
}

const BED = { gain: 0.35, head: 0, cut: 0, rate: 1 }

export type PlayOpts = {
  rateScale?: number
  offsetMs?: number
  recipe?: Recipe
}

export function playRecipe(recipe: Recipe, rateScale = 1, offsetMs = 0): () => void {
  const ac = unlock()
  const t0 = Math.max(ac.currentTime, ac.currentTime + offsetMs / 1000)
  const stop = render(ac, schedule(recipe, Math.max(0.05, rateScale)), t0, surfaceGain, files)
  for (const l of recipe)
    if (typeof l.source === 'object' && !files.has(l.source.file)) void primeFile(l.source.file)
  return stop
}

let surfaceGain = 1
export function setSurfaceGain(gain: number): void {
  surfaceGain = gain
}

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
  src.playbackRate.value = Math.max(0.05, rate)

  const amp = ac.createGain()
  amp.gain.value = gain
  src.connect(amp).connect(ac.destination)

  const t0 = Math.max(ac.currentTime, ac.currentTime + offsetMs / 1000)
  src.start(t0, Math.max(0, head / 1000))

  if (cut > 0) {
    const end = t0 + cut / 1000
    amp.gain.setValueAtTime(gain, end)
    amp.gain.linearRampToValueAtTime(0, end + RELEASE_MS / 1000)
    src.stop(end + RELEASE_MS / 1000)
  }
}

export function markGap(scope?: Element): number {
  return tune('--mark-stagger', scope)
}

let nextFree = 0

export function spacedPlan(
  now: number,
  free: number,
  gap: number,
  onsets: number[],
): { free: number; offsets: number[] } {
  const heard = Math.max(now, free)
  return {
    free: heard + gap,
    offsets: onsets.map((o) => Math.max(0, heard - o - now)),
  }
}

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

let bed: { cue: Cue; amp: GainNode; src: AudioBufferSourceNode } | null = null
let wanted: Cue | null = null

const FADE_MS = 900

export function startBed(cue: Cue): void {
  if (bed?.cue === cue) return
  wanted = cue
  const buf = buffers.get(cue)
  if (!buf) {
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

export function stopBed(): void {
  wanted = null
  if (!bed) return
  const { amp, src } = bed
  bed = null
  const ac = unlock()
  const end = ac.currentTime + FADE_MS / 1000
  amp.gain.cancelScheduledValues(ac.currentTime)
  amp.gain.setValueAtTime(amp.gain.value, ac.currentTime)
  amp.gain.linearRampToValueAtTime(0, end)
  src.stop(end)
}
