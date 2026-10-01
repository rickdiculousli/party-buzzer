import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { PokerFlick, PokerInput, ReactKind } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { FeltArc, FeltMark, PlayingCard, ShotRing, reducedMotion, usePokerCues } from './PokerParts.tsx'
import { classifyGesture, dealTimes, peekTip, bendCard, raiseStops, showsRight, GESTURE, PEEK, type Point, type TracePoint, type BendProfile } from './poker.ts'
import { pitch, simplifyFrames } from './toss.ts'
import { colorForPlayer, ordinal, playerName } from './ui.ts'

const AUTO_NOTE_MS = 2_000
const REACTS = Object.keys(REACT_LABEL) as ReactKind[]
/**
 * How the two hole cards lie once collected: the first square, the second turned across it and set
 * down and to the right, so every corner but one of the first and all four of the second show.
 */
const REST = [0, -24]
/** At showdown the pair squares up first, side by side in a slight fan like the board's, then turns over. */
const SQUARE = [-3, 3]
const SQUARE_MS = 280
/** How high a finger picks the pair up off the cloth, as a `Piece` lift: it sets the shadow. */
const PICKUP_LIFT = 0.035
/**
 * What a bet means, as two thick bars with their name and number printed inside: against the pot,
 * running to one pot and past it rescaled so the overbet glows (greyed when `ofPot` is null); and
 * against the stack. The print is laid twice, the second in the inverse colour and clipped to what
 * the fill covers, so it reads on either side of the fill's edge. Numbers bump as they change.
 */
function Meters({ ofPot, cost, stack }: { ofPot: number | null; cost: number; stack: number }) {
  const scale = Math.max(1, ofPot ?? 0)
  const share = stack ? Math.min(100, Math.round((cost / stack) * 100)) : 0
  const potText = ofPot === null ? '–' : `${Math.round(ofPot * 100) / 100}×`
  const print = (name: string, value: string) => [false, true].map((inv) =>
    <span key={String(inv)} class={`poker-meter__print ${inv ? 'is-inv' : ''}`} aria-hidden={inv || undefined}>
      <span>{name}</span><b key={value} class="poker-bump">{value}</b>
    </span>)
  return <>
    <div class={`poker-meter ${ofPot === null ? 'is-off' : ''}`}
      style={{ '--fill': ofPot === null ? 0 : Math.min(ofPot, 1) / scale, '--one': 1 / scale, '--cover': ofPot === null ? 0 : Math.min(ofPot, 1) }}>
      <span class={`poker-meter__bar ${(ofPot ?? 0) > 1 ? 'is-over' : ''}`}><i /><i />{print('Pot', potText)}</span>
    </div>
    <div class="poker-meter poker-meter--stack" style={{ '--fill': share / 100, '--cover': share / 100 }}>
      <span class="poker-meter__bar"><i />{print('Stack', `${share}%`)}</span>
    </div>
  </>
}
/** The slowest a flicked pair may take to leave the screen. */
const FLY_MAX_MS = 600
/** The pair turning over at showdown, both halves. */
const FLIP_MS = 420

type Move = { kind: PokerInput['kind'] } & Record<string, unknown>

/** Where the held pair sits under a finger that has moved `x`, `y` from where it pressed. */
const held = (x: number, y: number) => `translate(${x}px, ${Math.min(y, 40)}px) rotate(${x / 30}deg)`

/**
 * Throws the pair from where the finger let go: it leaves at the flick's speed along its line
 * and keeps going until it is past the screen edge, spinning the way it was thrown. Two
 * keyframes the browser interpolates off the main thread, held at the end, so no re-render can
 * pull the cards back. `speed` is the flick's 0..1 against `GESTURE.flickMaxSpeed`.
 */
function throwPair(node: HTMLElement, x: number, y: number, flick: PokerFlick) {
  const distance = Math.hypot(innerWidth, innerHeight) * 1.2
  const pxPerMs = Math.max(GESTURE.flickSpeed, flick.speed * GESTURE.flickMaxSpeed)
  const ms = Math.min(FLY_MAX_MS, distance / pxPerMs)
  const spin = x / 30 + flick.dx * 120 + (flick.dx < 0 ? -1 : 1) * 25 * flick.speed
  const to = `translate(${x + flick.dx * distance}px, ${Math.min(y, 40) + flick.dy * distance}px) rotate(${spin}deg)`
  return node.animate([{ transform: held(x, y) }, { transform: to }], { duration: ms, easing: 'cubic-bezier(0.3, 0.6, 0.6, 1)', fill: 'forwards' })
}

/** Measured once per gesture; the pair stays at its resting tilt during a peek. */
type CardGeometry = { w: number; h: number; left: number; top: number; cx: number; cy: number; cos: number; sin: number }
function geometryOf(card: HTMLElement, index: number): CardGeometry {
  const box = card.getBoundingClientRect()
  const parent = card.parentElement!.getBoundingClientRect()
  const style = getComputedStyle(card)
  const w = parseFloat(style.width), h = parseFloat(style.height)
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2
  const a = REST[index] * Math.PI / 180
  // offset* rounds to integers: the printed card and its bend must share fractional geometry.
  return { w, h, left: cx - parent.left - w / 2, top: cy - parent.top - h / 2,
    cx, cy, cos: Math.cos(a), sin: Math.sin(a) }
}
const cardPoint = (g: CardGeometry, x: number, y: number): Point => {
  const dx = x - g.cx, dy = y - g.cy
  return { x: dx * g.cos + dy * g.sin + g.w / 2, y: -dx * g.sin + dy * g.cos + g.h / 2 }
}
const screenPoint = (g: CardGeometry, p: Point): Point => {
  const dx = p.x - g.w / 2, dy = p.y - g.h / 2
  return { x: dx * g.cos - dy * g.sin + g.cx, y: dx * g.sin + dy * g.cos + g.cy }
}

const polygon = (points: Point[]) => `polygon(${points.map((p) => `${p.x}px ${p.y}px`).join(', ')})`

/** Draw the flexed bend directly; cached geometry keeps pointer frames free of layout reads. */
function drawPeel(card: HTMLElement, flap: HTMLElement, g: CardGeometry, index: number, corner: Point, finger: Point, reach?: number, profile?: BendProfile) {
  const base = card.firstElementChild as HTMLElement
  const bend = bendCard(g.w, g.h, corner, finger, REST[index], reach, profile)
  base.style.clipPath = bend ? polygon(bend.flat) : ''
  if (!bend) { flap.style.visibility = ''; return }
  flap.style.width = `${g.w}px`
  flap.style.height = `${g.h}px`
  const placement = `translate(${g.left + g.w / 2}px, ${g.top + g.h / 2}px) rotate(${REST[index]}deg) translate(${-g.w / 2}px, ${-g.h / 2}px)`
  const shadow = flap.firstElementChild as HTMLElement
  const xs = bend.shadow.map((p) => p.x), ys = bend.shadow.map((p) => p.y)
  const left = Math.min(...xs), top = Math.min(...ys)
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top
  shadow.style.opacity = String(bend.opacity)
  // A prepainted soft footprint: scaling and opacity avoid refiltering a moving polygon mask.
  shadow.style.transform = `${placement} translate(${left + width / 2 + 2}px, ${top + height / 2 + 3}px) scale(${width / g.w}, ${(height + 4) / g.h}) translate(${-g.w / 2}px, ${-g.h / 2}px)`
  // Stamp the samples only on the first peek, rather than cloning prints at deal.
  const layers = flap.lastElementChild as HTMLElement
  if (layers.children.length === 1) {
    const original = layers.firstElementChild!
    for (let i = 1; i < bend.strips.length; i++) layers.appendChild(original.cloneNode(true))
  }
  const stops = bend.shade.stops.map(({ at, light }) =>
    `${light > 0 ? `rgb(255 255 255 / ${light})` : `rgb(0 0 0 / ${-light})`} ${at}px`)
  const shade = `linear-gradient(${bend.shade.angle}deg, ${stops.join(',')})`
  const sheets = layers.querySelectorAll<HTMLElement>('.poker-peel__sheet')
  bend.strips.forEach((strip, i) => {
    const sheet = sheets[i]
    // A shared sample may miss this card entirely; polygon() is invalid and would retain an old clip.
    sheet.style.visibility = strip.clip.length >= 3 ? '' : 'hidden'
    if (strip.clip.length < 3) return
    sheet.style.clipPath = polygon(strip.clip)
    sheet.style.transform = `${placement} matrix(${strip.matrix.join(',')})`
    sheet.style.zIndex = String(strip.back ? index + 1 : 4 - index)
    sheet.classList.toggle('is-back', strip.back)
    // Keep changing light on this one leaf; inherited variables invalidate every cloned card descendant.
    const overlay = sheet.lastElementChild as HTMLElement
    overlay.style.background = shade
  })
  flap.style.visibility = 'visible'
}

/**
 * One hole card. On a fresh deal it is pitched in from above the top edge of the phone after
 * `delay`, straight into its place in the pair: no landing loose and gathering, so the pair can
 * be peeked the moment the second card is down. Each pitch leaves from a different spot along
 * the top and spins its own way.
 */
function DealtCard({ card, up, turned, squared, index, delay, seed }: {
  card: string; up: boolean; turned: boolean; squared: boolean; index: 0 | 1; delay: number | null; seed: number
}) {
  const el = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    if (!node || delay === null || reducedMotion()) return
    const box = node.getBoundingClientRect()
    const wide = (mulberry32(seed * 7 + 1)() - 0.5) * box.width * 0.8
    const from = { x: innerWidth / 2 - (box.left + box.width / 2) + wide, y: -(box.top + box.height * 1.2) }
    const frames = simplifyFrames(pitch(from, { x: 0, y: 0, rot: REST[index] }, mulberry32(seed)))
    const total = frames[frames.length - 1].t
    const run = node.animate(
      frames.map((f) => ({ transform: `translate(${f.x}px, ${f.y}px) rotate(${f.rot}deg) scale(${1 + f.lift})`, offset: f.t / total })),
      { duration: total, delay, fill: 'backwards', easing: 'linear' },
    )
    return () => run.cancel()
  }, [])
  // The base lies on the felt, clipped to what still lies flat while the card is peeked.
  // Turned over, the pair lies mirrored, so each card leans the other way.
  return <span ref={el} class="poker-hole__card" style={{ transform: `rotate(${(turned ? -1 : 1) * (squared ? SQUARE : REST)[index]}deg)` }}>
    <span class="poker-peel__base"><PlayingCard card={card} up={up} /></span>
  </span>
}

/**
 * The phone is a small felt table under its own lamp: flick the cards up to
 * fold, double tap the felt to check or call, hold low on the cards to bend up their bottom edge and peek. Raise
 * and all in sit on the rail, because an amount wants a slider.
 */
export function PokerPlayer({ state, playerId, frame, now, send, ack }: MinigamePlayerProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'player', session.matchId)
  const me = playerId ?? ''
  usePokerCues(poker, playerId)

  const trace = useRef<TracePoint[]>([])
  const onCards = useRef(false)
  // The touch began low on the cards, where corners are peeked: it peeks and never folds.
  const onCorners = useRef(false)
  const lastTap = useRef<number | null>(null)
  const peekTimer = useRef<ReturnType<typeof setTimeout>>()
  const reactSeq = useRef(-1)
  const seenFeed = useRef(0)
  // A peek in progress: the finger leads, the pair follows it one frame at a time. `pull` is how far the
  // leading edge is drawn (as it was let go, while dropping), in screen px.
  const peel = useRef<{ finger: Point; pull: Point; at: number; dropping: boolean; raf: number; wake: () => void } | null>(null)
  // The hand whose pair was flicked away: it stays mounted to finish flying once the fold lands.
  const [thrown, setThrown] = useState<number | null>(null)
  const [retired, setRetired] = useState<number | null>(null)
  const flight = useRef<Animation | null>(null)
  const foldSeq = useRef(-1)
  const hole = useRef<HTMLDivElement>(null)
  // The dashed line on the felt where peeking begins: one rank above the pair's lowest point. It is
  // placed from the pair's layout, which only changes with the screen, so it is measured when it
  // appears and on resize, never per frame.
  const peekLine = useRef<SVGSVGElement | null>(null)
  const placeLine = useCallback(() => {
    const node = hole.current
    const line = peekLine.current
    if (!node || !line) return
    let low = 0
    let w = 0
    node.querySelectorAll<HTMLElement>(':scope > .poker-hole__card').forEach((card, k) => {
      w = card.offsetWidth
      const h = card.offsetHeight
      const a = (REST[k] * Math.PI) / 180
      low = Math.max(low, card.offsetTop + h / 2 + Math.abs((w / 2) * Math.sin(a)) + Math.abs((h / 2) * Math.cos(a)))
    })
    line.style.top = `${node.offsetTop + low - PEEK.line * w}px`
  }, [])
  const lineRef = useCallback((el: SVGSVGElement | null) => { peekLine.current = el; placeLine() }, [placeLine])
  useEffect(() => {
    addEventListener('resize', placeLine)
    return () => removeEventListener('resize', placeLine)
  }, [placeLine])
  const [reactRefused, setReactRefused] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [raiseTo, setRaiseTo] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout>>()

  // When this hand's cards were dealt to this phone. A reload mid-hand deals nothing.
  const deal = useRef<{ hand: number; dealing: boolean } | null>(null)
  if (poker && deal.current?.hand !== poker.handNo) deal.current = { hand: poker.handNo, dealing: !!deal.current || poker.phase === 'deal' }

  const myTurn = !!poker?.legal
  const hand = poker?.handNo ?? 0
  const flying = thrown === hand && retired !== hand
  useEffect(() => { setSheet(false); setNote(null) }, [hand])
  // A new hand's pair is new elements; a peel of the old one just stops.
  const stopPeel = useCallback(() => {
    clearTimeout(peekTimer.current)
    cancelAnimationFrame(peel.current?.raf ?? 0)
    peel.current = null
    trace.current = []
    hole.current?.querySelectorAll<HTMLElement>('.poker-peel__base, .poker-peel__sheet').forEach((node) => node.style.removeProperty('clip-path'))
    hole.current?.querySelectorAll<HTMLElement>('.poker-peel__flap').forEach((node) => node.style.removeProperty('visibility'))
  }, [])
  useEffect(() => {
    addEventListener('resize', stopPeel)
    return () => { removeEventListener('resize', stopPeel); stopPeel(); flight.current?.cancel(); flight.current = null }
  }, [hand, stopPeel])
  useEffect(() => {
    if (ack?.seq === foldSeq.current && ack.status === 'refused') {
      flight.current?.cancel(); flight.current = null; setThrown(null); setRetired(null)
    }
  }, [ack])
  // At showdown the pair turns over as one, the way the board turns this seat's pair: edge-on, then
  // down mirrored, the card that was underneath on top. A phone that arrives with the cards already
  // shown just shows them.
  const shown = !!poker?.seats.find((seat) => seat.player === me)?.cards
  const [faceUp, setFaceUp] = useState(shown)
  const wasShown = useRef(shown)
  useEffect(() => {
    const turning = shown && !wasShown.current
    wasShown.current = shown
    const node = hole.current
    if (!turning || !node || reducedMotion()) return setFaceUp(shown)
    const seat = poker!.seats.findIndex((s) => s.player === me)
    // Turning toward the right lifts the left edge toward you and over, which is rotateY going negative.
    const way = showsRight(poker!.seats.length, seat, hand) ? -1 : 1
    const half = { duration: FLIP_MS / 2, fill: 'forwards' as const }
    const out = node.animate([{ transform: 'perspective(900px) rotateY(0deg)' }, { transform: `perspective(900px) rotateY(${90 * way}deg) scale(1.04)` }], { ...half, delay: SQUARE_MS, easing: 'ease-in' })
    let back: Animation | null = null
    out.onfinish = () => {
      setFaceUp(true)
      back = node.animate([{ transform: `perspective(900px) rotateY(${-90 * way}deg) scale(1.04)` }, { transform: 'perspective(900px) rotateY(0deg)' }], { duration: FLIP_MS / 2, easing: 'ease-out' })
      out.cancel()
    }
    return () => { out.cancel(); back?.cancel() }
  }, [shown, hand])
  // Once both cards of a fresh deal are down, one ripple of light round each says they can be peeked.
  useEffect(() => {
    const cards = [...hole.current?.querySelectorAll<HTMLElement>(':scope > .poker-hole__card') ?? []]
    const flights = cards.flatMap((card) => card.getAnimations())
    if (!flights.length) return
    let live = true
    void Promise.all(flights.map((run) => run.finished)).then(() => {
      if (live) for (const card of cards) card.classList.add('fx-ripple')
    }, () => {})
    return () => { live = false }
  }, [hand])
  useEffect(() => { if (myTurn) navigator.vibrate?.(60) }, [myTurn, hand, poker?.street])
  useEffect(() => { if (!myTurn) setSheet(false) }, [myTurn])
  useEffect(() => {
    if (ack && ack.seq === reactSeq.current && ack.status === 'refused') setReactRefused((n) => n + 1)
  }, [ack])
  useEffect(() => {
    if (!poker) return
    const fresh = poker.feed.filter((entry) => entry.id > seenFeed.current)
    seenFeed.current = Math.max(seenFeed.current, ...poker.feed.map((entry) => entry.id))
    const auto = fresh.find((entry) => entry.player === me && entry.auto)
    if (!auto) return
    setNote(auto.kind === 'fold' ? 'Auto-folded' : 'Auto-checked')
    // Its own clock: the next feed entry, usually only a moment later, must not cancel the clearing.
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), AUTO_NOTE_MS)
  }, [poker?.feed])
  useEffect(() => () => clearTimeout(noteTimer.current), [])

  const name = <p class="poker-phone__name" style={{ color: playerId ? colorForPlayer(state, playerId) : undefined }}>{playerName(state, me)}</p>

  if (session.phase === 'results') {
    const place = session.results?.find((row) => row.playerId === me)?.place
    return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
      <header class="poker-phone__top">{name}</header>
      <section class="poker-phone__still">
        <FeltMark text={place ? `${ordinal(place)} place` : 'Game over'} class="poker-phone__big" />
        {place === 1 && <FeltMark text="Takes the table" class="poker-phone__small" />}
      </section>
    </main>
  }
  if (!poker) return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
    <header class="poker-phone__top">{name}</header>
    <section class="poker-phone__still">
      <FeltMark text={frame?.role === 'spectator' ? 'Watching this game' : 'Shuffling up'} class="poker-phone__small" />
    </section>
  </main>

  const input = (value: Move) => {
    const seq = nextBowSequence(localStorage)
    send({ t: 'minigameInput', matchId: session.matchId, seq, input: { ...value, at: now() } as PokerInput })
    return seq
  }
  const mine = poker.seats.find((seat) => seat.player === me)
  const legal = poker.legal
  const actorName = poker.actor ? playerName(state, poker.actor) : null
  const pot = poker.pots.reduce((a, b) => a + b, 0) + poker.seats.reduce((a, seat) => a + seat.bet, 0)
  const reactions = <div key={reactRefused} class={`poker-tokens ${reactRefused ? 'fx-shake' : ''}`}>
    {REACTS.map((kind) => <button key={kind} class="poker-token" onClick={() => { reactSeq.current = input({ kind: 'react', react: kind }) }}>{REACT_LABEL[kind]}</button>)}
  </div>
  const top = <header class="poker-phone__top">
    {name}
    <p class="poker-phone__money">
      <span>Stack <b>{(mine?.stack ?? 0).toLocaleString()}</b></span>
      <span>Pot <b>{pot.toLocaleString()}</b></span>
    </p>
    {legal && poker.actBy && <ShotRing until={poker.actBy} total={session.options.shotSec * 1000} now={now} tick />}
  </header>

  if (poker.place !== null) {
    return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
      {top}
      <section class="poker-phone__still">
        <FeltMark text={`Out in ${ordinal(poker.place)}`} class="poker-phone__big fx-rubber-stamp" />
        <FeltMark text={actorName ? `${actorName} to act` : `Hand ${poker.handNo}`} class="poker-phone__small" />
      </section>
      {reactions}
    </main>
  }

  const inHand = !!poker.hole && !!mine && !mine.folded
  const point = (e: PointerEvent): TracePoint => ({ x: e.clientX, y: e.clientY, t: e.timeStamp })
  const down = (e: PointerEvent) => {
    // Capture keeps a flick's trace when the finger leaves the felt; a browser may refuse it.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* the trace still works inside the felt */ }
    trace.current = [point(e)]
    // Cards still being dealt or gathered are not in your hand yet: no peek, drag or flick.
    const dealt = !holeCards().some((card) => card.getAnimations().length)
    onCards.current = dealt && !!(e.target as HTMLElement).closest('.poker-hole')
    clearTimeout(peekTimer.current)
    // Below the peek line, on the cards or the felt, is where the pair is lifted: a steady hold there
    // peeks, and so does a drag (going back for another look starts moving at once). Flicks fold from above.
    const line = peekLine.current?.getBoundingClientRect()
    onCorners.current = !shown && dealt && inHand && !!line && e.clientY >= line.top + line.height / 2
    // Held above the line on your turn, the pair is picked up: its shadow grows while you mull a flick.
    if (onCards.current && !onCorners.current && legal && inHand) hole.current?.style.setProperty('--piece-lift', String(PICKUP_LIFT))
    if (onCorners.current) {
      peekTimer.current = setTimeout(() => {
        const at = trace.current[trace.current.length - 1]
        if (at) startPeel(at.x, at.y)
      }, GESTURE.pressMs)
    }
  }
  /**
   * Bends up the pair's bottom edge where the finger holds it, both cards together by one pull:
   * it rises toward a point just below the finger, near upright, then follows the finger.
   */
  const holeCards = () => [...hole.current?.querySelectorAll<HTMLElement>(':scope > .poker-hole__card') ?? []]
  const startPeel = (x: number, y: number) => {
    const cards = holeCards()
    const flaps = ([0, 1] as const).map((k) => hole.current?.querySelector<HTMLElement>(`:scope > .poker-peel__flap[data-card="${k}"]`))
    if (cards.length !== 2 || !flaps[0] || !flaps[1]) return
    // Settle the pair where it lies, so each card is where its tilt says it is.
    hole.current!.style.removeProperty('transition')
    hole.current!.style.removeProperty('transform')
    cancelAnimationFrame(peel.current?.raf ?? 0)
    // The pair is held at its bottom edge, right under the finger: the same spot on both cards,
    // even past a card's own side, so the two bend up as one stack.
    const geometry = cards.map(geometryOf)
    const anchors = geometry.map((g) => ({ x: cardPoint(g, x, y).x, y: g.h }))
    // The lower card's edge leads, levered up by the finger's rise, bending it over a crease. Bent
    // together the pair shares that crease: the other card is picked up when the crease reaches its edge
    // and folds over the same line, so its higher edge comes down that much short of the leading one.
    const at = geometry.map((g, k) => screenPoint(g, anchors[k]))
    const lead = at[1].y >= at[0].y ? 1 : 0
    // The lever measures the finger's rise from where it touched.
    const from = trace.current[0] ?? { x, y }
    peel.current = { finger: { x, y }, pull: { x: 0, y: 0 }, at: performance.now(), dropping: false, raf: 0, wake: () => {} }
    const frame = (now: number) => {
      const p = peel.current
      if (!p) return
      p.raf = 0
      if (!cards[1].isConnected) { peel.current = null; return }
      // A frame's timestamp is when the frame began, which can be just before the peek did: below 0 the
      // ease turns negative and folds the pair downward, flashing its faces up from below for a frame.
      const t = reducedMotion() ? 1 : Math.max(0, Math.min(1, (now - p.at) / (p.dropping ? PEEK.dropMs : PEEK.liftMs)))
      // Laid back down from wherever it was let go; lifted with an ease toward the finger.
      const e = p.dropping ? 1 - t * t : 1 - (1 - t) ** 3
      if (!p.dropping) {
        const tip = peekTip(at[lead], from, p.finger, geometry[lead].w)
        p.pull = tip ? { x: (tip.x - at[lead].x) * e, y: (tip.y - at[lead].y) * e } : { x: 0, y: 0 }
      }
      const pull = p.dropping ? { x: p.pull.x * e, y: p.pull.y * e } : p.pull
      const d = Math.hypot(pull.x, pull.y)
      const n = d ? { x: pull.x / d, y: pull.y / d } : { x: 0, y: -1 }
      const crease = { x: at[lead].x + pull.x / 2, y: at[lead].y + pull.y / 2 }
      const side = (q: Point) => (q.x - crease.x) * n.x + (q.y - crease.y) * n.y
      // A shared bend in screen space: tilted cards must not choose independent profiles or samples.
      const depth = Math.max(0, ...geometry.flatMap((g) =>
        [{ x: 0, y: 0 }, { x: g.w, y: 0 }, { x: g.w, y: g.h }, { x: 0, y: g.h }]
          .map((q) => -side(screenPoint(g, q)))))
      const profile = { depth, length: Math.min(geometry[lead].w * 0.3, depth * 0.85) }
      cards.forEach((card, k) => {
        // `peekTip` already bounds the pull; nothing clamps it again here, so the edge stays with the finger.
        // The leading card folds from where the finger holds it. The other folds from whichever bottom
        // corner the crease has reached furthest, the moment it reaches either: turned over the crease,
        // that corner lands as far beyond it. Same line, any point on the edge.
        const g = geometry[k]
        const { w, h } = g
        const from = k === lead ? anchors[k] : [{ x: 0, y: h }, { x: w, y: h }].reduce((a, b) => side(screenPoint(g, a)) <= side(screenPoint(g, b)) ? a : b)
        const past = Math.min(0, side(screenPoint(g, from)))
        const v = { x: -2 * past * n.x, y: -2 * past * n.y }
        // The pull is on screen; the card lies at its own tilt.
        const a = (-REST[k] * Math.PI) / 180
        drawPeel(card, flaps[k]!, g, k, from, { x: from.x + v.x * Math.cos(a) - v.y * Math.sin(a), y: from.y + v.x * Math.sin(a) + v.y * Math.cos(a) }, Infinity, profile)
      })
      if (p.dropping && t >= 1) { peel.current = null; return }
      if (t < 1) p.wake()
    }
    const p = peel.current
    p.wake = () => { if (!p.raf) p.raf = requestAnimationFrame(frame) }
    p.wake()
  }
  const move = (e: PointerEvent) => {
    if (!trace.current.length) return
    trace.current.push(point(e))
    const start = trace.current[0]
    // While peeking, the finger only carries the corner; the next frame draws it there.
    if (peel.current && !peel.current.dropping) {
      peel.current.finger = { x: e.clientX, y: e.clientY }; peel.current.wake(); return
    }
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > GESTURE.tapSlopPx
    if (onCorners.current) {
      // A peek still laying itself down is caught again where it is going.
      if (moved && (!peel.current || peel.current.dropping)) { clearTimeout(peekTimer.current); startPeel(e.clientX, e.clientY) }
      return
    }
    // A finger that moves is dragging, not pressing to peek.
    if (moved) clearTimeout(peekTimer.current)
    // Out of turn the cards stay put under the finger: nothing to throw yet. Written straight to
    // the element, so a drag costs no render.
    const node = hole.current
    if (onCards.current && legal && node) {
      // The pair follows the finger exactly; only the pick-up eases.
      node.style.transition = '--piece-lift 140ms ease'
      node.style.transform = held(e.clientX - start.x, e.clientY - start.y)
    }
  }
  const up = (e: PointerEvent) => {
    if (!trace.current.length) return
    trace.current.push(point(e))
    const start = trace.current[0]
    clearTimeout(peekTimer.current)
    // Letting go of a peel only lays the corner back down: it is never a fold or a tap.
    if (peel.current && !peel.current.dropping) {
      Object.assign(peel.current, { dropping: true, at: performance.now() })
      peel.current.wake()
      trace.current = []
      return
    }
    // Let go of the pair: without a throw it eases back home on the stylesheet's transition.
    const node = hole.current
    node?.style.removeProperty('transition')
    node?.style.removeProperty('transform')
    node?.style.removeProperty('--piece-lift')
    const gesture = classifyGesture(trace.current, lastTap.current)
    const end = trace.current[trace.current.length - 1].t
    trace.current = []
    if (gesture.kind === 'flick' && onCards.current && !onCorners.current && inHand) {
      if (!legal) {
        // Restart the shake in place; re-mounting the pair would replay its deal.
        const node = hole.current
        node?.classList.remove('fx-shake')
        void node?.offsetWidth
        node?.classList.add('fx-shake')
        return
      }
      setThrown(hand)
      foldSeq.current = input({ kind: 'fold', flick: gesture.flick })
      if (node && !reducedMotion()) {
        const run = throwPair(node, e.clientX - start.x, e.clientY - start.y, gesture.flick!)
        flight.current = run
        run.onfinish = () => { setRetired(hand); run.cancel(); flight.current = null }
      } else setRetired(hand)
    } else if (gesture.kind === 'doubleTap') {
      lastTap.current = null
      if (legal) input({ kind: legal.canCheck ? 'check' : 'call' })
    } else if (gesture.kind === 'tap') {
      lastTap.current = end
    }
  }

  const waiting = actorName ? `${actorName} to act` : ''
  const topLine = !inHand ? (mine?.folded ? 'Folded' : '') : 'Flick here to fold'
  const tapLine = !inHand ? waiting : !legal ? waiting : legal.canCheck ? 'Double tap to check' : `Double tap to call ${legal.call.toLocaleString()}`
  const highBet = Math.max(0, ...poker.seats.map((seat) => seat.bet))
  // Preflop with only the blinds in, raises are sized in big blinds and the pot means little.
  const unopened = poker.street === 'preflop' && highBet <= poker.bb
  const stops = legal ? raiseStops({ ...legal, highBet, pot, sb: poker.sb, bb: poker.bb, unopened }) : []
  // What a stop costs out of what you have behind: all in is all of it.
  // The raise over the bet to match, against the pot once the call is in.
  const ofPot = legal ? (raiseTo - highBet) / Math.max(1, pot + legal.call) : 0
  // Facing a bet, the felt spells the call out: what it costs, what it wins. Its pot bar sizes the bet
  // the way the raise sheet does, against the pot before it: the call over the pot without it, since
  // what's left to call is exactly the bet's raise over what was matched.
  // ponytail: one opponent's sizing; several callers in between make it read a little small.
  const facing = legal && !legal.canCheck && legal.call > 0 ? legal.call : 0
  const stop = Math.max(0, stops.findIndex((s) => s.to === raiseTo))
  // A landmark's stop number, or far off the rail when this street has no such stop.
  const landmark = (label: string) => { const i = stops.findIndex((s) => s.label === label); return i < 0 ? -99 : i }
  // Each stop clicks under the thumb like a detent.
  const toStop = (i: number) => { if (stops[i] && stops[i].to !== raiseTo) { navigator.vibrate?.(8); setRaiseTo(stops[i].to) } }
  const openSheet = () => { if (legal) { setRaiseTo(legal.minTo); setSheet(true) } }
  const confirmRaise = () => {
    if (!legal) return
    input(raiseTo >= legal.maxTo ? { kind: 'allIn' } : { kind: 'raise', to: raiseTo })
    setSheet(false)
  }
  const dealing = deal.current?.dealing ?? false
  // Each card comes when the board's dealer reaches this seat, once per round of the deal.
  const [first, second] = dealTimes(poker.seats, hand).get(poker.seats.indexOf(mine!)) ?? [0, 0]

  return <main class={`player poker-phone felt felt--phone ${legal ? 'poker-phone--turn' : ''}`}>
    <div class="felt__lamp felt__lamp--phone" />
    {top}
    <section class="poker-phone__table" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <FeltArc text={topLine} bow="up" class={legal && inHand ? '' : 'felt-arc--dim'} />
      <div class="poker-phone__spot">
        {((inHand && retired !== hand) || flying) && poker.hole && <div
          key={hand}
          ref={hole}
          class={`poker-hole ${shown ? 'poker-hole--square' : ''} ${faceUp && shown ? 'poker-hole--turned' : ''}`}
        >
          {([0, 1] as const).map((k) => <DealtCard key={`${hand}-${k}`} card={poker.hole![k]} up={faceUp && !!mine?.cards} turned={faceUp && shown} squared={shown} index={k}
            delay={dealing ? [first, second][k] : null} seed={hand * 2 + k} />)}
          {/* Both cards bend together; the bottom card wraps the outside and its raised face lies on top. */}
          {([1, 0] as const).map((k) => <span key={`${hand}-flap-${k}`} class="poker-peel__flap" data-card={k}>
            <span class="poker-peel__cast"><i /></span>
            <span class="poker-peel__layers"><span class="poker-peel__sheet"><PlayingCard card={poker.hole![k]} up peek /><span class="poker-peel__shade" /></span></span>
          </span>)}
        </div>}
        {inHand && !shown && <svg ref={lineRef} class="poker-peek-line" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
          <line class="felt-line__shade" x1="0" y1="3.5" x2="100" y2="3.5" />
          <line class="felt-line__sheen" x1="0" y1="3" x2="100" y2="3" />
        </svg>}
        {note && <p class="poker-phone__note fx-shake">{note}</p>}
      </div>
      <div class="poker-phone__foot">
        {/* Always laid out, shown only facing a bet: the cards sit clear of it either way and never move. */}
        <div class={`poker-call ${facing > 0 ? '' : 'is-off'}`} aria-hidden={facing > 0 ? undefined : true}>
          {/* Painted on a shallower curve of the tap line's own smile, so the two read as one set of table words. */}
          <FeltArc class="poker-call__arc" text={`Call ${facing.toLocaleString()} · win ${(pot + facing).toLocaleString()}`} bow="down" bend={36} />
          <div class="poker-call__meters"><Meters ofPot={facing / Math.max(1, pot - facing)} cost={facing} stack={mine?.stack ?? 0} /></div>
        </div>
        <FeltArc text={tapLine} bow="down" class={legal ? '' : 'felt-arc--dim'} />
      </div>
    </section>
    {reactions}
    {/* The raise sheet rises over the rail, so the table above never moves. */}
    {sheet && legal && <div class="poker-rail poker-rail--sheet">
          {/* One number to read, the amount; what it means shows as two bars. Whatever changes with a step
              bumps as it changes (keyed, so it replays), so the eye goes to it. */}
          <p class="poker-sheet__amount">
            <span key={stops[stop]?.label} class="poker-bump">{stops[stop]?.label}</span>
            <b key={raiseTo} class="poker-bump">{raiseTo.toLocaleString()}</b>
          </p>
          {/* With only the blinds in the pot bar stays, greyed: an open is sized in big blinds. */}
          <Meters ofPot={unopened ? null : ofPot} cost={raiseTo - (mine?.bet ?? 0)} stack={mine?.stack ?? 0} />
          <ol class="poker-sheet__stops" style={{ '--stops': Math.max(1, stops.length - 1) }}>
            {stops.map((s, i) => <li key={s.label} class={i === stop ? 'is-on' : ''} style={{ '--i': i }} onClick={() => toStop(i)}>
              {s.label.replace(' pot', '').replace(' BB', 'bb')}
            </li>)}
          </ol>
          <input class="poker-sheet__slider" type="range" min={0} max={stops.length - 1} step={1} value={stop}
            style={{ '--stops': Math.max(1, stops.length - 1), '--pos': stop / Math.max(1, stops.length - 1), '--half': landmark('1/2 pot'), '--whole': landmark('Pot') }} aria-label="Raise to" aria-valuetext={`${stops[stop]?.label}, ${raiseTo}`}
            onInput={(e) => toStop(Number((e.target as HTMLInputElement).value))} />
          <div class="poker-rail__row">
            <button class="poker-plaque poker-plaque--quiet" onClick={() => setSheet(false)}>Back</button>
            <button class="poker-plaque poker-plaque--go" onClick={confirmRaise}>{raiseTo >= legal.maxTo ? 'All in' : highBet > 0 ? 'Raise' : 'Bet'}</button>
          </div>
        </div>}
    <div class="poker-rail">
      <div class="poker-rail__row">
        <button class="poker-plaque" disabled={!legal?.canRaise} onClick={openSheet}>{highBet > 0 ? 'Raise' : 'Bet'}</button>
        <button class="poker-plaque" disabled={!legal?.canAllIn} onClick={() => input({ kind: 'allIn' })}>All in</button>
        {poker.canShow && <button class="poker-plaque poker-plaque--go fx-pop" onClick={() => input({ kind: 'show' })}>Show</button>}
      </div>
    </div>
  </main>
}
