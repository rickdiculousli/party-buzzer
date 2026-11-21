import type { PlayerId, PokerFeedEntry, PokerFlick, PokerSeatView, PokerShared } from '../shared/protocol.ts'
import { POKER_DEAL, pokerDealSpan } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { Cue } from './sound.ts'
import { dealSchedule } from './toss.ts'
import { ordinal } from './ui.ts'

export type PokerView = PokerShared & { matchId: string; serverTime: number }

export const GESTURE = {
  tapSlopPx: 10,
  doubleGapMs: 300,
  pressMs: 180,
  flickTravelPx: 60,
  flickSpeed: 0.8,
  flickMaxSpeed: 3,
  releaseMs: 80,
}

export const PEEK = { line: 0.25, lever: 2.5, tilt: 15, flex: 7, reach: 1.45, liftMs: 140, dropMs: 80 }

export type Point = { x: number; y: number }

export function peekTip(corner: Point, from: Point, finger: Point, w: number, p = PEEK): Point | null {
  const rise = from.y - finger.y
  if (rise * p.lever < 1) return null
  const up = Math.min(rise * p.lever, p.reach * w)
  const rad = Math.PI / 180
  const lean = Math.max(-Math.tan(p.tilt * rad), Math.min(-Math.tan((p.tilt - p.flex) * rad), (finger.x - from.x) / rise))
  return { x: corner.x + lean * up, y: corner.y - up }
}

export type TracePoint = { x: number; y: number; t: number }
export type Gesture = { kind: 'tap' | 'doubleTap' | 'flick' | 'press' | 'none'; flick?: PokerFlick }

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

export const seedOf = (...parts: (string | number)[]) => {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

export function dealTimes(seats: PokerSeatView[], handNo: number): Map<number, [number, number]> {
  const buttonAt = seats.findIndex((seat) => seat.button)
  const live = seats.map((seat, i) => ({ seat, i })).filter(({ seat }) => !seat.busted)
  const start = Math.max(0, live.findIndex(({ i }) => i > buttonAt))
  const order = [...live.slice(start), ...live.slice(0, start)].map(({ i }) => i)
  const schedule = dealSchedule(order.length, POKER_DEAL.gapMs, POKER_DEAL.roundMs, pokerDealSpan(order.length), mulberry32(seedOf(handNo, 'deal')))
  return new Map(order.map((i, at) => [i, [schedule[at], schedule[order.length + at]]]))
}

export const lie = (spread: number, ...parts: (string | number)[]) => (mulberry32(seedOf('lie', ...parts))() * 2 - 1) * spread

export const holeRest = (handNo: number, seat: number, k: 0 | 1) => (k ? 3 : -2) + lie(2, handNo, seat, k)

export function showsRight(seats: number, seat: number, handNo: number): boolean {
  const at = seatPositions(seats)[seat]
  const dx = ELLIPSE.cx - at.x
  if (Math.abs(dx) > 1e-6) return dx > 0
  const tilt = (holeRest(handNo, seat, 0) + holeRest(handNo, seat, 1)) / 2
  return at.y > ELLIPSE.cy ? tilt <= 0 : tilt >= 0
}

export const ELLIPSE = { cx: 0.44, cy: 0.5, rx: 0.37, ry: 0.4 }

export function seatPositions(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / n
    const x = ELLIPSE.cx + ELLIPSE.rx * Math.cos(angle)
    const y = ELLIPSE.cy + ELLIPSE.ry * Math.sin(angle)
    return i === 0 ? { x: ELLIPSE.cx, y: ELLIPSE.cy + ELLIPSE.ry } : { x, y }
  })
}

const TICK_FROM = 5
export const pokerClockCue = (before: number | null, after: number): Cue | null =>
  before !== null && after < before && after >= 1 && after <= TICK_FROM ? 'poker-tick' : null

export function pokerCues(prev: PokerView | null, next: PokerView, who: 'board' | PlayerId): { cue: Cue }[] {
  if (!prev || prev.matchId !== next.matchId) return []
  const out: Cue[] = []
  const add = (cue: Cue) => { if (!out.includes(cue)) out.push(cue) }
  const seen = Math.max(0, ...prev.feed.map((entry) => entry.id))
  const fresh = next.feed.filter((entry) => entry.id > seen)

  if (who === 'board') {
    const button = (view: PokerView) => view.seats.find((seat) => seat.button)?.player
    if (next.handNo > prev.handNo && button(next) !== button(prev)) add('poker-puck')
    if (next.runout && !prev.runout) add('poker-drumroll')
    for (const entry of fresh) {
      if (entry.kind === 'check') add('poker-check')
      else if (entry.kind === 'allIn') add('poker-allin')
      else if (entry.kind === 'win') add('poker-win')
      else if (entry.kind === 'bust') add('poker-bust')
      else if (entry.kind === 'level') add('poker-level')
    }
    const reacted = Math.max(0, ...prev.reactions.map((r) => r.id))
    if (next.reactions.some((r) => r.id > reacted)) add('poker-react')
    return out.map((cue) => ({ cue }))
  }

  if (fresh.some((entry) => entry.player === who && entry.auto)) add('poker-auto')
  return out.map((cue) => ({ cue }))
}

export const POKER_RULES = "No-limit Hold'em to the last stack. Flick your cards up to fold, double tap to check or call. Blinds rise on the clock."

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

const POT_SIZES: [number, string][] = [
  [1 / 3, '1/3 pot'], [1 / 2, '1/2 pot'], [2 / 3, '2/3 pot'], [3 / 4, '3/4 pot'], [1, 'Pot'], [1.5, '1.5× pot'], [2, '2× pot'],
]
const OPEN_SIZES: [number, string][] = [[2, '2 BB'], [2.5, '2.5 BB'], [3, '3 BB'], [4, '4 BB'], [5, '5 BB']]

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
