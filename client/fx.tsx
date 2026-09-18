/**
 * The interest kit's components: the effects that need markup or a clock.
 * Everything else is a class in the FX section of style.css. Rules and the
 * full catalogue: docs/design.md §4 "Interest kit".
 */
import { Fragment } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { BURST_COUNT, countAt, glitchCut, particles, words, type BurstKind } from './fx.ts'
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
 * A one-off spray of particles from the centre of the nearest positioned
 * ancestor (give it `fx-anchor`). It removes itself when the last particle
 * lands; mount a new one (a new `key`) to fire again. Renders nothing under
 * reduced motion.
 */
export function Burst({ kind, glyph, count }: { kind: BurstKind; glyph?: string; count?: number }) {
  const [bits] = useState(() => particles(kind, count ?? BURST_COUNT[kind], Math.random, glyph))
  const left = useRef(bits.length)
  const [done, setDone] = useState(false)
  if (done || reduced()) return null
  return (
    <span
      class={`fx-burst fx-burst--${kind}`}
      aria-hidden="true"
      onAnimationEnd={() => {
        if (--left.current === 0) setDone(true)
      }}
    >
      {bits.map((p, i) => (
        <i
          key={i}
          style={
            `--x:${p.x};--y:${p.y};--rot:${p.rot}deg;--delay:${p.delay}ms;--size:${p.size}` +
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
 * a breather, then the next. Every pass of a burst gets a new cut and each breather a
 * length within ±50% of `--fx-glitch-rest`, so no two hits look or land alike.
 * To stop it, render the plain text instead. Under reduced motion it stays
 * still.
 */
export function Glitch({ text, class: cls = '' }: { text: string; class?: string }) {
  const root = useRef<HTMLSpanElement>(null)
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A new cut: windows, shoves, band, and which repeats show. A new hit also
  // draws its length; a new pass inside a hit keeps the one it has.
  const recut = (el: HTMLElement, pass: boolean) => {
    for (const [k, v] of Object.entries(glitchCut())) if (!(pass && k === '--g-reps')) el.style.setProperty(k, v)
  }
  const hit = () => {
    const el = root.current
    if (!el || reduced()) return
    recut(el, false)
    el.classList.add('is-live')
  }
  useLayoutEffect(() => {
    hit()
    return () => clearTimeout(rest.current)
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
        const ms = parseTune(getComputedStyle(el).getPropertyValue('--fx-glitch-rest'), 1200)
        rest.current = setTimeout(hit, ms * (0.5 + Math.random()))
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
