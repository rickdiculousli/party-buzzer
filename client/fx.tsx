/**
 * The interest kit's components: the effects that need markup or a clock.
 * Everything else is a class in the FX section of style.css. Rules and the
 * full catalogue: docs/design.md §4 "Interest kit".
 */
import { Fragment } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { BURST_COUNT, countAt, glitchCut, particles, words, type BurstKind } from './fx.ts'

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
 * Text that glitches: cyan, magenta and yellow copies flicker through
 * quadrant windows and a band of the letters tears sideways, in a short burst
 * each cycle. A new cut is drawn before the first burst and after every one,
 * so the bursts never repeat. To stop it, render the plain text instead.
 */
export function Glitch({ text, class: cls = '' }: { text: string; class?: string }) {
  const root = useRef<HTMLSpanElement>(null)
  const recut = () => {
    for (const [k, v] of Object.entries(glitchCut())) root.current?.style.setProperty(k, v)
  }
  useLayoutEffect(recut, [])
  return (
    <span
      ref={root}
      class={`fx-glitch ${cls}`}
      // One cycle, one recut: every layer reports its own iteration, so only
      // the base's counts.
      onAnimationIteration={(e) => {
        if ((e.target as Element).classList.contains('fx-glitch__base')) recut()
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
