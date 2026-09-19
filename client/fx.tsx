/**
 * The interest kit's components: the effects that need markup or a clock.
 * Everything else is a class in the FX section of style.css. Rules and the
 * full catalogue: docs/design.md §4 "Interest kit".
 */
import { Fragment, type RefObject } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { BURST_COUNT, countAt, flashTimes, flipDeltas, glitchCut, particles, words, type Aim, type BurstKind, type Particle } from './fx.ts'
import { parseTune } from './sound.ts'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Text split into letters for the per-letter classes (`fx-wave`, `fx-rainbow`,
 * `fx-cascade`, `fx-jitter`, `fx-type`). Each word stays one unbreakable span;
 * a screen reader reads the hidden copy once instead of letter by letter.
 */
export function Letters({ text, class: cls = '' }: { text: string; class?: string }) {
  let i = 0
  return (
    <span class={`fx-letters ${cls}`}>
      <span class="fx-sr">{text}</span>
      <span aria-hidden="true">
        {words(text).map((word, w) => (
          <Fragment key={w}>
            {w > 0 && ' '}
            <span class="fx-word">
              {word.map((g) => (
                <span style={`--i:${i++}`}>{g}</span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  )
}

/** A number rolling up to its value. Under reduced motion it shows `to` at once. */
export function CountUp({ to, from = 0, ms = 600 }: { to: number; from?: number; ms?: number }) {
  const [n, setN] = useState(() => (reduced() ? to : from))
  useEffect(() => {
    if (reduced()) {
      setN(to)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = (t - t0) / ms
      setN(countAt(from, to, k))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, from, ms])
  return <span class="fx-count">{n}</span>
}

/**
 * A one-off spray of particles from the nearest positioned ancestor (give it
 * `fx-anchor`): from its centre, its whole outline (`from="edge"`), or one
 * side, aimed with `angle` and `spread` (see `Aim` in fx.ts). It measures the
 * box once on mount, so an outline spreads evenly along a long word. It
 * removes itself when the last particle lands; mount a new one (a new `key`)
 * to fire again. Renders nothing under reduced motion.
 */
export function Burst({
  kind,
  glyph,
  count,
  from,
  angle,
  spread,
}: { kind: BurstKind; glyph?: string; count?: number } & Omit<Aim, 'aspect'>) {
  const box = useRef<HTMLSpanElement>(null)
  const [bits, setBits] = useState<Particle[] | null>(null)
  const left = useRef(0)
  const [done, setDone] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    const aspect = el && el.offsetHeight ? el.offsetWidth / el.offsetHeight : 1
    const made = particles(kind, count ?? BURST_COUNT[kind], Math.random, glyph, { from, angle, spread, aspect })
    left.current = made.length
    setBits(made)
  }, [])
  if (done || reduced()) return null
  return (
    <span
      ref={box}
      class={`fx-burst fx-burst--${kind}`}
      aria-hidden="true"
      onAnimationEnd={() => {
        if (--left.current === 0) setDone(true)
      }}
    >
      {bits?.map((p, i) => (
        <i
          key={i}
          style={
            `--x:${p.x};--y:${p.y};--sx:${p.sx};--sy:${p.sy};--rot:${p.rot}deg;--delay:${p.delay}ms;--size:${p.size}` +
            (p.color ? `;color:${p.color}` : '')
          }
        >
          {p.glyph}
        </i>
      ))}
    </span>
  )
}

/**
 * Text that glitches in hits: a burst of cyan, magenta and yellow copies
 * flickering through quadrant windows while a band of the letters tears, then
 * a breather, then the next. Every pass of a burst gets a new cut and each
 * breather a length within ±20% of `--fx-glitch-rest`, so no two hits look or
 * land alike. Single flashes land in each breather, bunched toward its ends,
 * so the glitch wanes and waxes rather than switching off and on.
 * To stop it, render the plain text instead. Under reduced motion it stays
 * still.
 */
export function Glitch({ text, class: cls = '' }: { text: string; class?: string }) {
  const root = useRef<HTMLSpanElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (fn: () => void, ms: number) => void timers.current.push(setTimeout(fn, ms))

  // A new cut: windows, shoves, band, and which repeats show. A new hit also
  // draws its length; a new pass inside a hit keeps the one it has.
  const recut = (el: HTMLElement, pass: boolean) => {
    for (const [k, v] of Object.entries(glitchCut())) if (!(pass && k === '--g-reps')) el.style.setProperty(k, v)
  }
  const hit = () => {
    const el = root.current
    if (!el || reduced()) return
    timers.current = []
    el.classList.remove('is-flash')
    recut(el, false)
    el.classList.add('is-live')
  }
  // One beat of glitch inside a breather. The class comes off and back on
  // across a reflow so a flash restarts even straight after the last one.
  const flash = () => {
    const el = root.current
    if (!el) return
    recut(el, false)
    el.classList.remove('is-flash')
    void el.offsetWidth
    el.classList.add('is-flash')
  }
  useLayoutEffect(() => {
    hit()
    return () => timers.current.forEach(clearTimeout)
  }, [])

  return (
    <span
      ref={root}
      class={`fx-glitch ${cls}`}
      // Every layer reports its own passes and end; the base's are the hit's.
      // Each pass inside a hit gets a fresh cut, so a long hit never repeats.
      onAnimationIteration={(e) => {
        const el = root.current
        if (el && (e.target as Element).classList.contains('fx-glitch__base')) recut(el, true)
      }}
      onAnimationEnd={(e) => {
        const el = root.current
        if (!el || !(e.target as Element).classList.contains('fx-glitch__base')) return
        el.classList.remove('is-live')
        const ms = parseTune(getComputedStyle(el).getPropertyValue('--fx-glitch-rest'), 2500) * (0.8 + Math.random() * 0.4)
        for (const at of flashTimes(ms)) later(flash, at)
        later(hit, ms)
      }}
    >
      <span class="fx-glitch__base">{text}</span>
      <span class="fx-glitch__layer fx-glitch__c" aria-hidden="true">{text}</span>
      <span class="fx-glitch__layer fx-glitch__m" aria-hidden="true">{text}</span>
      <span class="fx-glitch__layer fx-glitch__y" aria-hidden="true">{text}</span>
      <span class="fx-glitch__layer fx-glitch__t" aria-hidden="true">{text}</span>
    </span>
  )
}

/**
 * Slides a list's children from where they were to where a re-sort put them.
 * Children need `data-key`. It moves them with `translate`, not `transform`,
 * so a row can wear a transform effect (an entrance pop) at the same time.
 * Under reduced motion rows just move.
 */
export function useFlip(list: RefObject<HTMLElement>) {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const rows = [...el.children] as HTMLElement[]
    const now = new Map(rows.filter((r) => r.dataset.key).map((r) => [r.dataset.key!, r.offsetTop]))
    const moves = flipDeltas(last.current, now)
    last.current = now
    if (reduced()) return
    for (const r of rows) {
      const dy = moves.get(r.dataset.key ?? '')
      if (!dy) continue
      r.style.transition = 'none'
      r.style.translate = `0 ${dy}px`
      void r.offsetWidth
      r.style.transition = 'translate var(--rank-slide-dur) var(--rate-even)'
      r.style.translate = ''
    }
  })
}

/**
 * A number's last change: where it came from, which way it went, and a count
 * that goes up on every change (0 until the first), for keying a replay.
 */
export function useDelta(value: number) {
  const r = useRef({ value, from: value, n: 0 })
  if (value !== r.current.value) r.current = { value, from: r.current.value, n: r.current.n + 1 }
  return { from: r.current.from, up: value >= r.current.from, n: r.current.n }
}

/**
 * A score that counts to its new value and flashes brass going up, tally red
 * going down. Still on first render, so a page load doesn't light every row.
 */
export function ScoreChange({ score, class: cls = '' }: { score: number; class?: string }) {
  const d = useDelta(score)
  return (
    <span
      key={d.n}
      class={d.n ? `${cls} fx-flash fx-flash--tint` : cls}
      style={d.n ? { '--fx-color': d.up ? 'var(--brass)' : 'var(--tally)' } : undefined}
    >
      <CountUp from={d.from} to={score} />
    </span>
  )
}
