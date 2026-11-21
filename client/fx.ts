const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemes(text: string): string[] {
  return Array.from(SEG.segment(text), (s) => s.segment)
}

export function words(text: string): string[][] {
  return text.split(/\s+/).filter(Boolean).map(graphemes)
}

export type BurstKind = 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji'

export type Particle = {
  x: number
  y: number
  rot: number
  delay: number
  size: number
  color: string
  glyph: string
  sx: number
  sy: number
}

export const BURST_COUNT: Record<BurstKind, number> = {
  sparkle: 12,
  dust: 10,
  confetti: 24,
  embers: 14,
  stars: 10,
  emoji: 8,
}

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--fx-${n})`)
const WARM = ['var(--hot)', 'var(--tungsten)', 'var(--brass)']

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type BurstFrom = 'center' | 'edge' | Side | Side[]
export type Aim = { from?: BurstFrom; angle?: number; spread?: number; aspect?: number }

const OUTWARD = { top: -90, bottom: 90, left: 180, right: 0 } as const

export function particles(
  kind: BurstKind,
  count: number,
  rand: () => number = Math.random,
  glyph = '🎉',
  aim: Aim = {},
): Particle[] {
  const r = (lo: number, hi: number) => lo + (hi - lo) * rand()
  const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length)]
  const at = (deg: number, dist: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * dist,
    y: Math.sin((deg * Math.PI) / 180) * dist,
  })

  const own = (): Omit<Particle, 'sx' | 'sy'> => {
    switch (kind) {
      case 'sparkle':
        return { ...at(r(0, 360), r(0.5, 1)), rot: 0, delay: r(0, 300), size: r(0.6, 1.2), color: pick(WARM), glyph: '✦' }
      case 'dust':
        return { ...at((rand() < 0.5 ? 180 : 0) + r(-25, 25), r(0.4, 0.8)), rot: 0, delay: r(0, 60), size: r(0.8, 1.6), color: 'var(--dim)', glyph: '' }
      case 'confetti':
        return { ...at(r(210, 330), r(0.6, 1)), rot: r(-720, 720), delay: r(0, 80), size: r(0.7, 1.1), color: pick(PALETTE), glyph: '' }
      case 'embers':
        return { x: r(-0.3, 0.3), y: r(-0.95, -0.6), rot: 0, delay: r(0, 400), size: r(0.4, 0.9), color: pick(['var(--tungsten)', 'var(--tally)']), glyph: '' }
      case 'stars':
        return { ...at(r(0, 360), r(0.7, 1)), rot: r(-180, 180), delay: r(0, 60), size: r(0.7, 1.2), color: pick(['var(--brass)', 'var(--hot)']), glyph: '★' }
      case 'emoji':
        return { ...at(r(200, 340), r(0.6, 1)), rot: r(-30, 30), delay: r(0, 80), size: r(0.8, 1.3), color: '', glyph }
    }
  }

  const from = aim.from ?? 'center'
  const sides: Side[] =
    from === 'center' ? [] : from === 'edge' ? ['top', 'bottom', 'left', 'right'] : Array.isArray(from) ? from : [from]
  const outward = sides.length > 1
  const length = (s: Side) => (s === 'top' || s === 'bottom' ? (aim.aspect ?? 1) : 1)
  const total = sides.reduce((n, s) => n + length(s), 0)
  const side = (): Side => {
    let t = rand() * total
    for (const s of sides) if ((t -= length(s)) < 0) return s
    return sides[sides.length - 1]
  }

  return Array.from({ length: count }, (): Particle => {
    const p = own()
    if (from === 'center' && aim.angle === undefined) return { ...p, sx: 0, sy: 0 }
    const s = sides.length > 1 ? side() : (sides[0] ?? null)
    const [sx, sy] =
      s === 'top' ? [r(-1, 1), -1] : s === 'bottom' ? [r(-1, 1), 1] : s === 'left' ? [-1, r(-1, 1)] : s === 'right' ? [1, r(-1, 1)] : [0, 0]
    const dir = aim.angle ?? (outward && s ? OUTWARD[s] : undefined)
    if (dir === undefined) return { ...p, sx, sy }
    const spread = aim.spread ?? 60
    return { ...p, ...at(dir + r(-spread, spread), Math.hypot(p.x, p.y)), sx, sy }
  })
}

export function countAt(from: number, to: number, k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return Math.round(from + (to - from) * (1 - (1 - t) ** 3))
}

const QUADRANTS = [
  [0, 50, 50, 0],
  [0, 0, 50, 50],
  [50, 50, 0, 0],
  [50, 0, 0, 50],
  [0, 0, 60, 0],
  [55, 0, 0, 0],
]

export function glitchCut(rand: () => number = Math.random): Record<string, string> {
  const r = (lo: number, hi: number) => lo + (hi - lo) * rand()
  const nudge = () => Math.round(r(0, 15))
  const window = () => {
    const [t, rt, b, l] = QUADRANTS[Math.floor(rand() * QUADRANTS.length)]
    return `inset(${t + nudge()}% ${rt + nudge()}% ${b + nudge()}% ${l + nudge()}%)`
  }
  const shove = () => ((rand() < 0.5 ? -1 : 1) * r(0.4, 1)).toFixed(2)
  const out: Record<string, string> = {}
  for (const layer of ['c', 'm', 'y']) {
    out[`--g${layer}-k1`] = window()
    out[`--g${layer}-k2`] = window()
    out[`--g${layer}-x1`] = shove()
    out[`--g${layer}-x2`] = shove()
    out[`--g${layer}-o2`] = rand() < 0.65 ? '1' : '0'
    out[`--g${layer}-o3`] = rand() < 0.5 ? '1' : '0'
  }
  const top = Math.round(r(15, 70))
  out['--gt-top'] = `${top}%`
  out['--gt-bot'] = `${top + Math.round(r(6, 14))}%`
  out['--gt-x'] = shove()
  out['--g-reps'] = r(1, 3).toFixed(2)
  return out
}

export function flashTimes(rest: number, rand: () => number = Math.random): number[] {
  const n = 1 + Math.floor(rand() * 4)
  return Array.from({ length: n }, () => {
    const edge = rand() ** 2 * 0.45
    return Math.round(rest * (rand() < 0.5 ? 0.05 + edge : 0.95 - edge))
  }).sort((a, b) => a - b)
}

export function flipDeltas(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, top] of after) {
    const was = before.get(key)
    if (was !== undefined && was !== top) out.set(key, was - top)
  }
  return out
}
