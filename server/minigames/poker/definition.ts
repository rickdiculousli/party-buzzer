import { randomInt } from 'node:crypto'
import type { PlayerId, PokerFlick, PokerPrivate, PokerShared, ReactKind } from '../../../shared/protocol.ts'
import { REACT_LABEL } from '../../../shared/protocol.ts'
import type { Clock, InputOutcome, MinigameDefinition } from '../definition.ts'
import {
  act, createTable, finished, legal, levelOf, places, resumeTable, setPresence, STEP_MS, stepTable, tableCheckpoint,
} from './table.ts'
import type { PokerCheckpoint, PokerOptions, PokerWorld } from './types.ts'

const REACT_GAP_TICKS = 3_000 / STEP_MS
const REACTIONS_MAX = 10
const KINDS = new Set(['fold', 'check', 'call', 'raise', 'allIn', 'show', 'react'])
const INVALID: InputOutcome = { status: 'refused', reason: 'invalid' }

const optionsOf = (options: Record<string, number>): PokerOptions =>
  ({ stack: options.stack, bigBlind: options.bigBlind, levelMin: options.levelMin, shotSec: options.shotSec })

/** A unit direction and a speed clamped to 0–1, or nothing when the numbers are unusable. */
function cleanFlick(flick: unknown): PokerFlick | undefined {
  const f = flick as Partial<PokerFlick> | null
  if (!f || ![f.dx, f.dy, f.speed].every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  const length = Math.hypot(f.dx!, f.dy!)
  if (!length) return undefined
  const round = (n: number) => Math.round(n * 1000) / 1000
  return { dx: round(f.dx! / length), dy: round(f.dy! / length), speed: round(Math.min(1, Math.max(0, f.speed!))) }
}

function shared(w: PokerWorld, clock: Clock): PokerShared {
  const actor = w.actor === null ? null : w.seats[w.actor]
  return {
    phase: w.phase.at,
    street: w.street,
    seats: w.seats.map((seat, i) => ({
      player: seat.player,
      stack: seat.stack,
      bet: seat.bet,
      button: i === w.button,
      sb: i === w.sbSeat,
      bb: i === w.bbSeat,
      folded: seat.folded,
      allIn: !!seat.hole && !seat.folded && !seat.out && seat.stack === 0,
      busted: seat.out,
      away: !seat.connected,
      cards: seat.faceUp ? seat.hole : null,
    })),
    board: w.board,
    pots: w.pots.map((pot) => pot.amount),
    actor: actor?.player ?? null,
    actBy: w.actBy === null ? null : clock(w.actBy * STEP_MS),
    handNo: w.handNo,
    sb: w.sb,
    bb: w.bb,
    nextLevelAt: clock(levelOf(w).nextAtTick * STEP_MS),
    equity: w.equity,
    runout: w.runout,
    showdown: w.showdown,
    feed: w.feed,
    reactions: w.reactions,
    discard: w.seats.filter((seat) => seat.hole && seat.folded).length * 2,
  }
}

function personal(w: PokerWorld, player: PlayerId): PokerPrivate | null {
  const seat = w.seats.find((s) => s.player === player)
  if (!seat) return null
  return {
    hole: seat.out ? null : seat.hole,
    legal: legal(w, player),
    canShow: w.phase.at === 'muck' && w.phase.winner === player && !w.phase.shown,
    place: w.busted.find((row) => row.player === player)?.place ?? null,
  }
}

export const poker: MinigameDefinition<PokerWorld> = {
  stepMs: STEP_MS,
  untimed: true,
  startable: (_lobby, connected) => connected.length < 2 ? 'too-few-players' : null,
  create: (seed, participants, options) => ({ world: createTable(seed, participants, optionsOf(options), randomInt(2 ** 31)) }),
  finished,
  classify(input) {
    const i = input as { kind?: unknown; at?: unknown; to?: unknown } | null
    if (typeof i?.kind !== 'string' || !KINDS.has(i.kind)) return null
    if (typeof i.at !== 'number' || !Number.isFinite(i.at)) return null
    if (i.kind === 'raise' && (typeof i.to !== 'number' || !Number.isFinite(i.to))) return null
    return 'discrete'
  },
  apply(w, player, input) {
    if (input.kind === 'react') {
      if (!Object.hasOwn(REACT_LABEL, input.react)) return INVALID
      if (w.tick - (w.lastReact[player] ?? -Infinity) < REACT_GAP_TICKS) return { status: 'refused', reason: 'too-soon' }
      w.lastReact[player] = w.tick
      w.reactions.push({ id: w.nextFeedId++, player, kind: input.react as ReactKind })
      if (w.reactions.length > REACTIONS_MAX) w.reactions.shift()
      return { status: 'accepted' }
    }
    if (input.kind === 'raise') {
      if (!Number.isInteger(input.to) || input.to <= 0) return INVALID
      return act(w, player, { kind: 'raise', to: input.to })
    }
    if (input.kind === 'fold') {
      const flick = cleanFlick(input.flick)
      return act(w, player, flick ? { kind: 'fold', flick } : { kind: 'fold' })
    }
    return act(w, player, { kind: input.kind })
  },
  step: stepTable,
  tick: (w) => w.tick,
  boardFrame: (w, clock) => shared(w, clock),
  playerFrame(w, player, clock) {
    const mine = personal(w, player)
    return mine && { ...shared(w, clock), ...mine }
  },
  results: (w) => places(w).map(({ playerId, place }) => ({ playerId, points: 0, shots: 0, place })),
  presence: setPresence,
  checkpoint: tableCheckpoint,
  resume(data, options) {
    const world = resumeTable(data as PokerCheckpoint, optionsOf(options))
    return { world, participants: world.seats.map((seat) => seat.player) }
  },
  hostStatus(w, clock) {
    const seats = w.seats.filter((seat) => !seat.out).length
    return [
      { text: `Hand ${w.handNo}` },
      { text: `Blinds ${w.sb} / ${w.bb}`, until: clock(levelOf(w).nextAtTick * STEP_MS) },
      { text: `${seats} seats left` },
    ]
  },
}
