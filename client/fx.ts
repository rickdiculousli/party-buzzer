/**
 * The interest kit's plain logic, kept apart from the components so Node can
 * test it. The components are in fx.tsx; the motion is the FX section of
 * style.css; the rules are docs/design.md §4 "Interest kit".
 */

const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Characters as a person counts them: an emoji or an accented letter is one. */
export function graphemes(text: string): string[] {
  return Array.from(SEG.segment(text), (s) => s.segment)
}

/** Words as grapheme lists, so a per-letter effect never breaks a word across lines. */
export function words(text: string): string[][] {
  return text.split(/\s+/).filter(Boolean).map(graphemes)
}

export type BurstKind = 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji'

/** One particle's path. `x`/`y` are the end offset in units of the burst amount. */
export type Particle = {
  x: number
  y: number
  rot: number
  delay: number
  size: number
  color: string
  glyph: string
  /** Where it starts, −1…1 of the box's half-width and half-height; 0,0 is the centre. */
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
/**
 * Where a burst starts and which way it goes. `from` picks the start: the
 * centre, anywhere on the outline (`edge`), one side, or a list of sides. The
 * direction is `angle` (degrees, 0 is right, 90 is down) if given, outward
 * from the side for `edge` or a list, and the kind's own otherwise; `spread`
 * fans either side of it. `aspect` is the box's width over its height, so
 * sides get particles in proportion to their length.
 */
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
  // An angle in degrees (0 is right, 90 is down) and a distance, as an offset.
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
  // Several sides throw outward; one side keeps the kind's own direction.
  const outward = sides.length > 1
  // A side, picked in proportion to its length.
  const length = (s: Side) => (s === 'top' || s === 'bottom' ? (aim.aspect ?? 1) : 1)
  const total = sides.reduce((n, s) => n + length(s), 0)
  const side = (): Side => {
    let t = rand() * total
    for (const s of sides) if ((t -= length(s)) < 0) return s
    return sides[sides.length - 1]
  }

  return Array.from({ length: count }, (): Particle => {
    const p = own()
    // Today's burst, drawing nothing extra from `rand`, so a seed still gives
    // the same one.
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

/** What a count-up shows at progress `k` (0…1): ease-out, whole numbers. */
export function countAt(from: number, to: number, k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return Math.round(from + (to - from) * (1 - (1 - t) ** 3))
}

/**
 * Where a glitch cuts on one burst: for each colour channel (c, m, y) two
 * quadrant-ish windows with a sideways offset each, whether its optional
 * repeats show at all, and one horizontal band that tears. `<Glitch>` draws a fresh
 * set every burst, so no two look alike. Offsets are fractions of the amount.
 */
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
  // A real shove either way, never a near-zero one that reads as nothing.
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
  // How many times through the burst this hit runs: fractional, so a hit can
  // stop anywhere inside its last pass.
  out['--g-reps'] = r(1, 3).toFixed(2)
  return out
}

/**
 * When a breather's single glitch flashes land, in ms from its start: one to
 * four, bunched toward both ends, so the glitch wanes out of one hit and waxes
 * into the next rather than switching off and on.
 */
export function flashTimes(rest: number, rand: () => number = Math.random): number[] {
  const n = 1 + Math.floor(rand() * 4)
  return Array.from({ length: n }, () => {
    const edge = rand() ** 2 * 0.45
    return Math.round(rest * (rand() < 0.5 ? 0.05 + edge : 0.95 - edge))
  }).sort((a, b) => a - b)
}

/**
 * How far each row has to be pushed back to sit where it was before a
 * re-sort: old top minus new top, for rows present both times that moved.
 * New rows are left out; they have nowhere to come from.
 */
export function flipDeltas(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, top] of after) {
    const was = before.get(key)
    if (was !== undefined && was !== top) out.set(key, was - top)
  }
  return out
}
