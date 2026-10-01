import type { PlayerId, PokerFeedEntry, PokerFlick, PokerSeatView, PokerShared } from '../shared/protocol.ts'
import { POKER_DEAL, pokerDealSpan } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { Cue } from './sound.ts'
import { dealSchedule } from './toss.ts'
import { ordinal } from './ui.ts'

/** A board or phone frame, as far as cues and wording need one. */
export type PokerView = PokerShared & { matchId: string; serverTime: number }

/**
 * Gesture thresholds, to tune on a real phone. A still touch shorter than
 * `pressMs` is a tap; longer is a press (the peek). Speeds are px/ms over the
 * last `releaseMs` of the trace.
 */
export const GESTURE = {
  tapSlopPx: 10,
  doubleGapMs: 300,
  pressMs: 180,
  flickTravelPx: 60,
  flickSpeed: 0.8,
  flickMaxSpeed: 3,
  releaseMs: 80,
}

/**
 * The peek, to tune on a real phone. A hold or drag below the peek line, `line` card widths (about
 * a rank) above the pair's lowest point, on the cards or the felt, bends up the pair's bottom edge
 * where the finger holds it, both cards together, the way a pair is squeezed.
 * The bent edge is levered: it rises `lever` times as far as the finger has come up since it
 * touched, so a short drag shows a lot, and the edge runs ahead of the finger rather than under
 * it. The pull always leans `tilt` degrees up and to the left, which lifts the right corners
 * furthest, so a peek always opens on them; the finger may ease it back at most `flex` degrees
 * toward upright. It rises at most `reach` card widths, enough for both indices. It eases in
 * over `liftMs` and drops back over `dropMs`.
 */
export const PEEK = { line: 0.25, lever: 2.5, tilt: 15, flex: 7, reach: 1.2, liftMs: 140, dropMs: 120 }

export type Point = { x: number; y: number }

/**
 * A card peeled at `corner` so the corner's tip touches `finger`, in the card's own px
 * (origin top left, y down, `w` × `h`). The card folds along the perpendicular bisector of
 * corner and tip: `flat` is the part still lying down, in card px; `lifted` is the flap,
 * in the face's px (the face is the back mirrored left to right), and `matrix` (CSS
 * `matrix()`, origin top left) carries the face onto the felt, which flips it over the
 * fold. `shade` lays a highlight along the fold on the face's own gradient line, so the
 * flat flap reads as curved paper. Null when the finger sits on the corner itself.
 */
export function peelCard(w: number, h: number, corner: Point, finger: Point, reach = PEEK.reach * w) {
  const far = Math.hypot(finger.x - corner.x, finger.y - corner.y)
  if (far < 1) return null
  const n = { x: (finger.x - corner.x) / far, y: (finger.y - corner.y) / far }
  const d = Math.min(far, reach)
  const tip = { x: corner.x + n.x * d, y: corner.y + n.y * d }
  const mid = { x: (corner.x + tip.x) / 2, y: (corner.y + tip.y) / 2 }
  const side = (p: Point) => (p.x - mid.x) * n.x + (p.y - mid.y) * n.y
  const box = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
  const lifted: Point[] = []
  const flat: Point[] = []
  box.forEach((p, i) => {
    const q = box[(i + 1) % 4]
    const sp = side(p)
    const sq = side(q)
    ;(sp < 0 ? lifted : flat).push(p)
    if ((sp < 0) !== (sq < 0)) {
      const t = sp / (sp - sq)
      const cut = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
      lifted.push(cut)
      flat.push(cut)
    }
  })
  const reflect = (p: Point) => ({ x: p.x - 2 * side(p) * n.x, y: p.y - 2 * side(p) * n.y })
  const origin = reflect({ x: w, y: 0 })
  // On the face (mirrored left to right), the way from the fold toward the corner.
  const v = { x: n.x, y: -n.y }
  const length = Math.abs(w * v.x) + Math.abs(h * v.y)
  const foldAt = (w - mid.x - w / 2) * v.x + (mid.y - h / 2) * v.y + length / 2
  return {
    tip,
    flat,
    lifted: lifted.map((p) => ({ x: w - p.x, y: p.y })),
    matrix: [-(1 - 2 * n.x * n.x), 2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, origin.x, origin.y] as const,
    shade: { angle: (Math.atan2(v.x, -v.y) * 180) / Math.PI, foldAt, depth: d / 2 },
  }
}

/**
 * Where a peek pulls the held point `corner` of the bottom edge, in screen px for a card `w` wide,
 * once the finger has moved from `from` to `finger`: up `lever` times the finger's rise, at most
 * `reach`, leaning `tilt` to the left, or up to `flex` less as far as the finger leans right.
 * Null until the finger has risen, so the cards lie flat.
 */
export function peekTip(corner: Point, from: Point, finger: Point, w: number, p = PEEK): Point | null {
  const rise = from.y - finger.y
  if (rise * p.lever < 1) return null
  const up = Math.min(rise * p.lever, p.reach * w)
  const rad = Math.PI / 180
  const lean = Math.max(-Math.tan(p.tilt * rad), Math.min(-Math.tan((p.tilt - p.flex) * rad), (finger.x - from.x) / rise))
  return { x: corner.x + lean * up, y: corner.y - up }
}

/** y grows downward, as on screen. */
export type TracePoint = { x: number; y: number; t: number }
export type Gesture = { kind: 'tap' | 'doubleTap' | 'flick' | 'press' | 'none'; flick?: PokerFlick }

/** Names one finished touch. `prevTapEnd` is when the last tap lifted, for double taps. */
export function classifyGesture(trace: TracePoint[], prevTapEnd: number | null, g = GESTURE): Gesture {
  if (!trace.length) return { kind: 'none' }
  const start = trace[0]
  const end = trace[trace.length - 1]
  const moved = Math.max(...trace.map((p) => Math.hypot(p.x - start.x, p.y - start.y)))
  const duration = end.t - start.t
  if (moved <= g.tapSlopPx) {
    if (duration >= g.pressMs) return { kind: 'press' }
    return { kind: prevTapEnd !== null && start.t - prevTapEnd <= g.doubleGapMs ? 'doubleTap' : 'tap' }
  }
  const from = trace.find((p) => p.t >= end.t - g.releaseMs) ?? start
  const dt = Math.max(1, end.t - from.t)
  const dx = end.x - from.x
  const dy = end.y - from.y
  const speed = Math.hypot(dx, dy) / dt
  if (start.y - end.y >= g.flickTravelPx && dy < 0 && speed >= g.flickSpeed) {
    const length = Math.hypot(dx, dy)
    return { kind: 'flick', flick: { dx: dx / length, dy: dy / length, speed: Math.min(1, speed / g.flickMaxSpeed) } }
  }
  return { kind: 'none' }
}

/** A stable seed for one card's throw, so a re-render never re-rolls its path. */
export const seedOf = (...parts: (string | number)[]) => {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/**
 * When each seat's two cards leave the dealer's hand, ms from the start of the deal:
 * clockwise from the seat left of the button, one card each, then the second.
 * The board and every phone read the same times, so a phone's cards arrive as the
 * board's dealer reaches that seat. Busted seats get none.
 */
export function dealTimes(seats: PokerSeatView[], handNo: number): Map<number, [number, number]> {
  const buttonAt = seats.findIndex((seat) => seat.button)
  const live = seats.map((seat, i) => ({ seat, i })).filter(({ seat }) => !seat.busted)
  const start = Math.max(0, live.findIndex(({ i }) => i > buttonAt))
  const order = [...live.slice(start), ...live.slice(0, start)].map(({ i }) => i)
  const schedule = dealSchedule(order.length, POKER_DEAL.gapMs, POKER_DEAL.roundMs, pokerDealSpan(order.length), mulberry32(seedOf(handNo, 'deal')))
  return new Map(order.map((i, at) => [i, [schedule[at], schedule[order.length + at]]]))
}

/** How far off square a card comes to rest, in degrees, fixed for that card so it never moves after landing. */
export const lie = (spread: number, ...parts: (string | number)[]) => (mulberry32(seedOf('lie', ...parts))() * 2 - 1) * spread

/** A seat's hole card `k` on the board, turned this far beyond the seat's own tilt: squared up, the second a little across the first. */
export const holeRest = (handNo: number, seat: number, k: 0 | 1) => (k ? 3 : -2) + lie(2, handNo, seat, k)

/**
 * Which way a seat's pair turns over at showdown, as the board turns it (`turnUp`, toward the
 * middle along the cards' width): true for toward screen right. The phone turns its pair the
 * same way. The seat straight below the middle has the middle dead ahead, so the pair's own
 * slight tilt decides, as it does on the board.
 */
export function showsRight(seats: number, seat: number, handNo: number): boolean {
  const at = seatPositions(seats)[seat]
  const dx = ELLIPSE.cx - at.x
  if (Math.abs(dx) > 1e-6) return dx > 0
  // Dead ahead, the pair's width tips toward the middle by its tilt: a seat below the middle turns
  // right when the pair leans anticlockwise, a seat above when it leans clockwise.
  const tilt = (holeRest(handNo, seat, 0) + holeRest(handNo, seat, 1)) / 2
  return at.y > ELLIPSE.cy ? tilt <= 0 : tilt >= 0
}

/** The table's oval in board-normalized units. */
export const ELLIPSE = { cx: 0.44, cy: 0.5, rx: 0.37, ry: 0.4 }

/** Seat centres around the oval: the first at bottom centre, then clockwise, which is the table's "left". */
export function seatPositions(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / n
    const x = ELLIPSE.cx + ELLIPSE.rx * Math.cos(angle)
    const y = ELLIPSE.cy + ELLIPSE.ry * Math.sin(angle)
    // Snap the float noise off the first seat so it lands exactly at bottom centre.
    return i === 0 ? { x: ELLIPSE.cx, y: ELLIPSE.cy + ELLIPSE.ry } : { x, y }
  })
}

/** The shot clock's last seconds tick. */
const TICK_FROM = 5
/** Tick from the local deadline clock; sparse state pushes do not carry countdown cues. */
export const pokerClockCue = (before: number | null, after: number): Cue | null =>
  before !== null && after < before && after >= 1 && after <= TICK_FROM ? 'poker-tick' : null
const STREET_CUE: Record<number, Cue> = { 3: 'poker-flop', 4: 'poker-turn', 5: 'poker-river' }

/**
 * The cues one surface plays for the change from `prev` to `next`. `who` is
 * `'board'` or the phone's player id. Room cues play on the board, a player's
 * own cues on their phone. A first frame, or one from another match, only sets
 * the baseline.
 */
export function pokerCues(prev: PokerView | null, next: PokerView, who: 'board' | PlayerId): { cue: Cue }[] {
  if (!prev || prev.matchId !== next.matchId) return []
  const out: Cue[] = []
  const add = (cue: Cue) => { if (!out.includes(cue)) out.push(cue) }
  const seen = Math.max(0, ...prev.feed.map((entry) => entry.id))
  const fresh = next.feed.filter((entry) => entry.id > seen)

  if (who === 'board') {
    if (next.handNo > prev.handNo) add('poker-deal')
    if (next.board.length > prev.board.length && STREET_CUE[next.board.length]) add(STREET_CUE[next.board.length])
    if (next.runout && !prev.runout) add('poker-drumroll')
    for (const entry of fresh) {
      if (entry.kind === 'check') add('poker-check')
      else if (entry.kind === 'call' || entry.kind === 'bet' || entry.kind === 'raise' || entry.kind === 'blind') add('poker-chips')
      else if (entry.kind === 'allIn') add('poker-allin')
      else if (entry.kind === 'win') add('poker-win')
      else if (entry.kind === 'bust') add('poker-bust')
      else if (entry.kind === 'level') add('poker-level')
    }
    return out.map((cue) => ({ cue }))
  }

  if (next.actor === who && prev.actor !== who) add('poker-yours')
  if (fresh.some((entry) => entry.player === who && entry.auto)) add('poker-auto')
  return out.map((cue) => ({ cue }))
}

/** The lobby's one-line explanation, on the board. */
export const POKER_RULES = "No-limit Hold'em to the last stack. Flick your cards up to fold, double tap to check or call. Blinds rise on the clock."

/** One feed entry as the room reads it. `nameOf` may return '' for a line without the name. */
export function feedLine(entry: PokerFeedEntry, nameOf: (id: PlayerId) => string): string {
  const who = entry.player ? nameOf(entry.player) : ''
  switch (entry.kind) {
    case 'fold': return `${who} ${entry.auto ? 'timed out' : 'folds'}`
    case 'check': return `${who} checks`
    case 'call': return `${who} calls ${entry.amount}`
    case 'bet': return `${who} bets ${entry.amount}`
    case 'raise': return `${who} raises to ${entry.amount}`
    case 'allIn': return `${who} is all in for ${entry.amount}`
    case 'blind': return `${who} posts ${entry.amount}`
    case 'show': return `${who} shows`
    case 'win': return `${who} wins ${entry.amount}${entry.hand ? ` with ${entry.hand.toLowerCase()}` : ''}`
    case 'bust': return `${who} is out in ${ordinal(entry.amount ?? 0)}`
    case 'level': return `Blinds up to ${Math.floor((entry.amount ?? 0) / 2)} / ${entry.amount}`
  }
}

/** Raise sizes as fractions of the pot, the way players say them: the usual postflop sizes and two overbets. */
const POT_SIZES: [number, string][] = [
  [1 / 3, '1/3 pot'], [1 / 2, '1/2 pot'], [2 / 3, '2/3 pot'], [3 / 4, '3/4 pot'], [1, 'Pot'], [1.5, '1.5× pot'], [2, '2× pot'],
]
/** An unopened pot preflop is raised in big blinds instead. */
const OPEN_SIZES: [number, string][] = [[2, '2 BB'], [2.5, '2.5 BB'], [3, '3 BB'], [4, '4 BB'], [5, '5 BB']]

/**
 * The stops of the raise slider: the minimum and each standard size short of all in, which has its own
 * button. Preflop with only the blinds in, sizes are big blinds; otherwise a fraction of the pot once
 * the call is in, on top of the bet to match. Every size rounds to the small blind.
 */
export function raiseStops(
  { minTo, maxTo, highBet, pot, call, sb, bb, unopened }:
  { minTo: number; maxTo: number; highBet: number; pot: number; call: number; sb: number; bb: number; unopened: boolean },
): { to: number; label: string }[] {
  const stops = [{ to: minTo, label: 'Min' }]
  for (const [size, label] of unopened ? OPEN_SIZES : POT_SIZES) {
    const to = Math.round((unopened ? size * bb : highBet + size * (pot + call)) / sb) * sb
    if (to > stops[stops.length - 1].to && to < maxTo) stops.push({ to, label })
  }
  return stops
}
