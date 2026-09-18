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

export function particles(
  kind: BurstKind,
  count: number,
  rand: () => number = Math.random,
  glyph = '🎉',
): Particle[] {
  const r = (lo: number, hi: number) => lo + (hi - lo) * rand()
  const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length)]
  // An angle in degrees (0 is right, 90 is down) and a distance, as an offset.
  const at = (deg: number, dist: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * dist,
    y: Math.sin((deg * Math.PI) / 180) * dist,
  })

  return Array.from({ length: count }, (): Particle => {
    switch (kind) {
      case 'sparkle':
        return { ...at(r(0, 360), r(0.2, 0.6)), rot: 0, delay: r(0, 300), size: r(0.6, 1.2), color: pick(WARM), glyph: '✦' }
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
  })
}

/** What a count-up shows at progress `k` (0…1): ease-out, whole numbers. */
export function countAt(from: number, to: number, k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return Math.round(from + (to - from) * (1 - (1 - t) ** 3))
}
