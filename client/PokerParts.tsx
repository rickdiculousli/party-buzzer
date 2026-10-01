import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Card } from '../shared/protocol.ts'
import { pokerCues, type PokerView } from './poker.ts'
import { play } from './sound.ts'
import { chipStack, topShades, type Frame, type Pose } from './toss.ts'

/** Suit pips drawn on a 100-unit square, so every card prints the same shapes at any size. */
const PIP: Record<string, string> = {
  h: 'M50 90C22 68 5 51 5 32C5 17 16 7 30 7c9 0 16 5 20 13c4-8 11-13 20-13c14 0 25 10 25 25c0 19-17 36-45 58z',
  d: 'M50 4Q68 29 90 50Q68 71 50 96Q32 71 10 50Q32 29 50 4z',
  s: 'M50 5C61 24 95 40 95 62c0 14-11 22-23 22c-9 0-15-4-18-10c1 10 5 18 13 22H33c8-4 12-12 13-22c-3 6-9 10-18 10C16 84 5 76 5 62C5 40 39 24 50 5z',
  c: 'M50 8a19 19 0 0 1 16 29a19 19 0 1 1-10 34c1 10 5 18 12 23H32c7-5 11-13 12-23a19 19 0 1 1-10-34A19 19 0 0 1 50 8z',
}
const RANK: Record<string, string> = { T: '10' }
const COURT = new Set(['J', 'Q', 'K'])
const SUIT_NAME: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

export function SuitPip({ suit, class: cls = '' }: { suit: string; class?: string }) {
  return <svg class={`poker-pip ${cls}`} viewBox="0 0 100 100" aria-hidden="true"><path d={PIP[suit]} /></svg>
}

/** Two-ended court portraits, printed in the same ink as the corner indices. */
function CourtPortrait({ rank }: { rank: string }) {
  const jack = rank === 'J'
  const queen = rank === 'Q'
  return <svg class="poker-card__court" viewBox="0 0 60 104" aria-hidden="true">
    {[false, true].map((turned) => <g key={String(turned)} transform={turned ? 'rotate(180 30 52)' : undefined}>
      {/* A broad robe and a cut-paper profile keep their shape at table size. */}
      <path fill="currentColor" d="M9 51V46Q10 41 23 37V30H36V37Q49 41 51 46V51Z" />
      <path fill="currentColor" d={queen
        ? 'M19 20Q19 11 29 11Q40 11 40 21L38 31L26 30V35Q26 43 17 43Q8 43 8 34Q11 39 16 37Q19 36 18 31Z'
        : 'M20 19Q20 12 30 12Q40 12 40 21V30Q35 36 25 32L20 29Z'} />
      <path class="poker-card__paper" d="M27 19H38V23L43 27L38 29V33Q33 37 28 32L25 28V23Z" />
      <path fill="currentColor" d={jack
        ? 'M18 17Q17 7 31 8L39 15L43 18H18Z'
        : queen
          ? 'M20 17L20 12Q24 15 27 12L30 8L33 12Q36 15 40 12L39 17Z'
          : 'M20 16L18 5L25 10L30 3L35 10L42 5L39 16Z'} />
      {jack && <path fill="currentColor" d="M20 12Q10 11 12 2Q21 3 23 10Z" />}
      {!jack && <path class="poker-card__paper-line" d={queen ? 'M23 15H36' : 'M23 13H36'} />}
      {queen
        ? <>
            <path class="poker-card__paper-line" d="M22 22V34Q22 40 16 40Q12 40 11 37" />
            <circle class="poker-card__paper" cx="26" cy="30" r="1.6" />
          </>
        : <path fill="currentColor" d={jack ? 'M25 19L28 19L26 26L23 25Z' : 'M26 29Q32 34 38 31L36 39L29 36Z'} />}
      <path class="poker-card__ink-line" d="M35 23H37M37 30H39" />
      <path class="poker-card__paper-line" d="M23 38L38 51M36 38L30 43M17 44V51M44 44V51" />
    </g>)}
    <path class="poker-card__ink-line" d="M9 52H51" />
  </svg>
}

/**
 * A poker-size card (63 × 88 mm) with its face and back on either side, so
 * turning it over is a real flip. Corner indices read when cards overlap.
 * Given a `hinge` (a share of its width from its left edge), it is turned over
 * by the `Piece` carrying it, about that hinge, rather than by `up`. `peek` prints
 * an index in all four corners, as peek decks do, so any lifted corner reads.
 */
export function PlayingCard({ card, up, hinge, peek, class: cls = '' }: { card: Card | null; up: boolean; hinge?: number; peek?: boolean; class?: string }) {
  const suit = card?.[1] ?? 's'
  const rank = card ? RANK[card[0]] ?? card[0] : ''
  const red = suit === 'h' || suit === 'd'
  const showing = up && !!card
  return <span
    class={`poker-card ${showing ? 'poker-card--up' : ''} ${hinge === undefined ? '' : 'poker-card--hinged'} ${cls}`}
    style={hinge === undefined ? undefined : { '--hinge': hinge }}
    role="img"
    aria-label={showing ? `${rank} of ${SUIT_NAME[suit]}` : 'face-down card'}
  >
    <span class="poker-card__turn">
      <span class={`poker-card__face ${red ? 'poker-card__face--red' : ''}`}>
        {card && <>
          <span class="poker-card__index"><span class="poker-card__rank">{rank}</span><SuitPip suit={suit} /></span>
          <span class="poker-card__index poker-card__index--foot"><span class="poker-card__rank">{rank}</span><SuitPip suit={suit} /></span>
          {peek && <>
            <span class="poker-card__index poker-card__index--right"><span class="poker-card__rank">{rank}</span><SuitPip suit={suit} /></span>
            <span class="poker-card__index poker-card__index--foot-left"><span class="poker-card__rank">{rank}</span><SuitPip suit={suit} /></span>
          </>}
          {COURT.has(card[0])
            ? <CourtPortrait rank={rank} />
            : <SuitPip suit={suit} class={card[0] === 'A' ? 'poker-card__ace' : 'poker-card__centre'} />}
        </>}
      </span>
      <span class="poker-card__back"><span class="poker-card__lattice" /></span>
    </span>
  </span>
}

/**
 * A bet as real chips: side-on slices under a face-up top chip, biggest at the
 * bottom, standing on its spot however tall. `held` bottom chips and `pending`
 * top chips keep their place but are not drawn: a stack sliding onto another
 * carries the chips it lands on as `held`, and the stack it lands on waits with
 * them `pending`. Its shadow only counts chips that are there. `part` draws
 * just the shadow or just the chips, so a pile can lay every shadow under every
 * chip. `shades` are taller neighbours' shadows across its top, from `topShades`.
 */
export function ChipStack({ amount = 0, chips = chipStack(amount), held = 0, pending = 0, part, shades = [], class: cls = '' }: {
  amount?: number; chips?: number[]; held?: number; pending?: number; part?: 'shade' | 'chips'; shades?: { x: number; y: number; dx: number; dy: number }[]; class?: string
}) {
  const standing = chips.length - pending
  if (!chips.length) return null
  const shaded = !held && standing > 0 && part !== 'chips'
  return <span class={`poker-stack ${shaded ? '' : 'poker-stack--unshaded'} ${cls}`} style={{ '--n': chips.length, '--standing': Math.max(1, standing) }} aria-hidden="true">
    {part !== 'shade' && chips.map((value, i) => <span key={i} class={`poker-chip poker-chip--${value}`} style={{ '--i': i, visibility: i < held || i >= standing ? 'hidden' : undefined }}>
      {i === standing - 1 && shades.length > 0 && <span class="poker-chip__shades">
        {/* A caster's column where it meets this top, drawn out along its cast: a disc stretched into an oval. */}
        {shades.map(({ x, y, dx, dy }, k) => <span key={k} class="poker-chip__shade" style={{
          '--len': `${Math.hypot(dx, dy)}px`,
          transform: `translate(${x}px, ${y}px) rotate(${Math.atan2(dy, dx)}rad)`,
        }} />)}
      </span>}
    </span>)}
  </span>
}

/**
 * Stacks standing together, as the pot or a winner's share of it: `x`, `y`
 * place each in pixels from the corral's middle, `at` places that middle on
 * the table and `lamp` is the lamp, both in table pixels. Every shadow goes on
 * the felt first, then every stack back to front, so a nearer, taller stack
 * covers the ones behind and shades their tops. `pending` chips on a stack are
 * still sliding in.
 */
export function Corral({ stacks, at, lamp, chipW }: {
  stacks: { x: number; y: number; chips: number[]; pending?: number }[]; at: { x: number; y: number }; lamp: { x: number; y: number }; chipW: number
}) {
  const shades = topShades(stacks.map((stack) => ({ x: at.x + stack.x, y: at.y + stack.y, n: stack.chips.length - (stack.pending ?? 0) })), lamp, chipW)
  const order = [...stacks.keys()].sort((a, b) => stacks[a].y - stacks[b].y)
  return <span class="poker-corral">
    {(['shade', 'chips'] as const).map((part) => order.map((k) =>
      <span key={`${k}-${part}`} class="poker-corral__stack" style={{ transform: `translate(${stacks[k].x}px, ${stacks[k].y}px) translate(-50%, -50%)` }}>
        <ChipStack chips={stacks[k].chips} pending={stacks[k].pending} part={part} shades={shades[k]} />
      </span>))}
  </span>
}

export function DealerPuck() {
  return <span class="poker-puck" role="img" aria-label="dealer button"><span class="poker-puck__word">Dealer</span></span>
}

/**
 * Words painted onto the felt: gold that took on most fibres and missed some,
 * over a soft shadow of the pile standing around it.
 */
export function FeltMark({ text, class: cls = '' }: { text: string; class?: string }) {
  return <span class={`felt-mark ${cls}`}>
    <span class="felt-mark__press" aria-hidden="true">{text}</span>
    <span class="felt-mark__ink">{text}</span>
  </span>
}

/**
 * Painted words along an arc, the way a table carries "insurance pays 2 to 1".
 * The paint's broken fibres come from the `--paint-fibre` mask. `bow` up is a
 * frown, down a smile; `bend` is how deep, 80 for the table's own lines.
 */
export function FeltArc({ text, bow, bend = 80, class: cls = '' }: { text: string; bow: 'up' | 'down'; bend?: number; class?: string }) {
  const id = useRef(`arc-${Math.random().toString(36).slice(2)}`).current
  const d = bow === 'up' ? `M24 ${bend - 2} Q200 -2 376 ${bend - 2}` : `M24 10 Q200 ${10 + bend} 376 10`
  return <svg class={`felt-arc ${cls}`} viewBox={`0 0 400 ${bend + 8}`} role="img" aria-label={text}>
    <PaintPile id={`${id}-pile`} />
    <path id={id} d={d} fill="none" />
    <text class="felt-arc__press"><textPath href={`#${id}`} startOffset="50%" text-anchor="middle">{text}</textPath></text>
    <text class="felt-arc__ink" filter={`url(#${id}-pile)`}><textPath href={`#${id}`} startOffset="50%" text-anchor="middle">{text}</textPath></text>
  </svg>
}

/**
 * The felt's fibres inside painted marks: grey noise overlaid on the paint and
 * kept to its shape, so no painted stroke is ever a flat colour.
 */
export function PaintPile({ id }: { id: string }) {
  return <defs>
    <filter id={id} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 1.6" numOctaves="3" seed="7" result="noise" />
      <feColorMatrix in="noise" values=".95 .95 .95 0 -.9  .95 .95 .95 0 -.9  .95 .95 .95 0 -.9  0 0 0 0 1" result="fibres" />
      <feBlend in="SourceGraphic" in2="fibres" mode="overlay" result="paint" />
      {/* The felt's dark specks on top, as on the bare cloth around the mark. */}
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="11" result="grain" />
      <feColorMatrix in="grain" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0" result="specks" />
      <feComposite in="specks" in2="paint" operator="over" result="cloth" />
      <feComposite in="cloth" in2="SourceGraphic" operator="in" />
    </filter>
  </defs>
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const transformOf = (p: Pose, lift = 0) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.rot}deg) scale(${1 + lift})`

/**
 * Something lying on the felt at a pose, in table pixels. Given `frames`, it
 * first travels them after `delay`, holding the first frame until then, and
 * calls `done` on arrival. Reduced motion puts it straight at rest.
 */
export function Piece({ pose, frames, delay = 0, done, class: cls = '', children }: {
  pose: Pose; frames?: Frame[] | null; delay?: number; done?: () => void; class?: string; children: ComponentChildren
}) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    if (!node || !frames?.length || reducedMotion()) { done?.(); return }
    const total = frames[frames.length - 1].t || 1
    const run = node.animate(
      // Place, height and rotation also go to the card's shadow, which falls from the lamp rather than turning with the card, and a turn over to a hinged card.
      frames.map((f) => ({
        transform: transformOf(f, f.lift), '--piece-x': f.x, '--piece-y': f.y, '--piece-lift': f.lift, '--piece-rot': f.rot,
        ...(f.turn === undefined ? {} : { '--piece-turn': f.turn }),
        ...(f.z === undefined ? {} : { zIndex: f.z }),
        offset: f.t / total,
      })),
      { duration: total, delay, fill: 'backwards', easing: 'linear' },
    )
    run.onfinish = () => done?.()
    return () => run.cancel()
  }, [])
  // At rest it keeps the place in the pile its move ended in.
  const z = frames?.[frames.length - 1]?.z
  return <div ref={el} class={`poker-piece ${cls}`} style={{ transform: transformOf(pose), '--piece-x': pose.x, '--piece-y': pose.y, '--piece-rot': pose.rot, zIndex: z }}>{children}</div>
}

/**
 * A container's size in pixels, kept current as the window changes. The ref is
 * a callback, so a container that mounts later (after a waiting screen) is
 * still measured.
 */
export function useSize<T extends HTMLElement>(): [(node: T | null) => void, { w: number; h: number }] {
  const [node, setNode] = useState<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!node) return
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(node)
    return () => watch.disconnect()
  }, [node])
  return [setNode, size]
}

/** Plays this surface's cues as frames arrive. `who` is 'board' or the phone's player id. */
export function usePokerCues(frame: PokerView | null, who: string | null) {
  const prev = useRef<PokerView | null>(null)
  useEffect(() => {
    if (!frame || !who) return
    for (const { cue } of pokerCues(prev.current, frame, who)) play(cue)
    prev.current = frame
  }, [frame, who])
}

/** A thin ring that empties as a shot clock runs down; the last seconds beat. */
export function ShotRing({ until, total, now, class: cls = '' }: { until: number; total: number; now: number; class?: string }) {
  const left = Math.max(0, until - now)
  const share = Math.min(1, left / total)
  const r = 45
  const around = 2 * Math.PI * r
  return <svg class={`poker-ring ${left <= 5_000 ? 'fx-heartbeat' : ''} ${cls}`} viewBox="0 0 100 100" role="img" aria-label={`${Math.ceil(left / 1000)} seconds to act`}>
    <circle class="poker-ring__track" cx="50" cy="50" r={r} />
    <circle class="poker-ring__left" cx="50" cy="50" r={r} transform="rotate(-90 50 50)" style={{ strokeDasharray: around, strokeDashoffset: around * (1 - share) }} />
  </svg>
}
