import type { PlayerId, PokerFeedEntry, PokerFlick, PokerShared } from '../shared/protocol.ts'
import type { Cue } from './sound.ts'
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

/** The table's oval in board-normalized units. */
export const ELLIPSE = { cx: 0.44, cy: 0.5, rx: 0.37, ry: 0.38 }

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
const secondsLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 1000))
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
  if (next.actor === who && prev.actor === who && next.actBy !== null && next.actBy === prev.actBy) {
    const before = secondsLeft(prev.actBy, prev.serverTime)
    const after = secondsLeft(next.actBy, next.serverTime)
    if (after < before && after >= 1 && after <= TICK_FROM) add('poker-tick')
  }
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
