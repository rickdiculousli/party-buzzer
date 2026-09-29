import type { PlayerId, PokerFeedEntry } from '../../../shared/protocol.ts'
import { mulberry32 } from '../../../shared/random.ts'
import type { InputOutcome } from '../definition.ts'
import { shuffle } from '../shuffle.ts'
import { handDeck } from './cards.ts'
import { equity } from './equity.ts'
import { best, compare } from './evaluate.ts'
import { awardPots, buildPots } from './pots.ts'
import type { Legal, PokerAction, PokerCheckpoint, PokerOptions, PokerWorld, Seat } from './types.ts'

export const STEP_MS = 50
/** How long each beat of a hand lasts, in ms. */
export const PACE = { dealMs: 1500, revealMs: 1200, runoutMs: 2500, showdownMs: 5000, muckMs: 4000, awayShotMs: 2000 }
const FEED_MAX = 20

const ticks = (ms: number) => Math.round(ms / STEP_MS)
const OK: InputOutcome = { status: 'accepted' }
const NO: InputOutcome = { status: 'refused', reason: 'not-allowed' }
const INVALID: InputOutcome = { status: 'refused', reason: 'invalid' }

const inHand = (seat: Seat) => !seat.out && !!seat.hole && !seat.folded
const canBet = (seat: Seat) => inHand(seat) && seat.stack > 0

function table(seed: number, opts: PokerOptions, seats: PokerCheckpoint['seats'], button: number): PokerWorld {
  return {
    tick: 0, seed, opts,
    seats: seats.map(({ player, stack, out }) => ({
      player, stack, startStack: stack, hole: null, bet: 0, contributed: 0,
      folded: false, acted: false, mayRaise: true, connected: true, faceUp: false, out,
    })),
    busted: [], button, sbSeat: 0, bbSeat: 0, handNo: 0, elapsedBase: 0,
    bb: opts.bigBlind, sb: Math.floor(opts.bigBlind / 2), street: 'preflop', board: [], deck: [],
    actor: null, actBy: null, highBet: 0, raiseSize: opts.bigBlind, pots: [], showdown: null,
    runout: false, equity: null, feed: [], nextFeedId: 1, reactions: [], lastReact: {}, phase: { at: 'deal', until: 0 },
    saved: null,
  }
}

export function createTable(seed: number, participants: PlayerId[], opts: PokerOptions): PokerWorld {
  const rand = mulberry32(seed)
  const order = shuffle(rand, participants)
  // The first hand moves the button one seat on, onto a seeded seat.
  const button = (Math.floor(rand() * order.length) + order.length - 1) % order.length
  const w = table(seed, opts, order.map((player) => ({ player, stack: opts.stack, out: false })), button)
  startHand(w)
  return w
}

export function tableCheckpoint(w: PokerWorld): { version: number; label: string; data: PokerCheckpoint } | null {
  return w.saved && { version: w.saved.handNo, label: `hand ${w.saved.handNo}`, data: w.saved }
}

/** Deals the checkpoint's hand again, from the same stacks, button and deck. */
export function resumeTable(data: PokerCheckpoint, opts: PokerOptions): PokerWorld {
  const w = table(data.seed, opts, data.seats, data.button)
  w.busted = data.busted.map((row) => ({ ...row }))
  w.handNo = data.handNo - 1
  w.elapsedBase = data.elapsed
  w.bb = levelOf(w).bb
  startHand(w)
  return w
}

export function feed(w: PokerWorld, entry: Omit<PokerFeedEntry, 'id'>): void {
  w.feed.push({ id: w.nextFeedId++, ...entry })
  if (w.feed.length > FEED_MAX) w.feed.splice(0, w.feed.length - FEED_MAX)
}

/** The next seat after `from`, going left, that passes `test`; -1 if none. */
function next(w: PokerWorld, from: number, test: (seat: Seat) => boolean): number {
  const n = w.seats.length
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n
    if (test(w.seats[i])) return i
  }
  return -1
}

/** Seat players in order starting left of the button. */
function leftOfButton(w: PokerWorld): PlayerId[] {
  const n = w.seats.length
  return Array.from({ length: n }, (_, step) => w.seats[(w.button + 1 + step) % n].player)
}

function pay(w: PokerWorld, seat: Seat, amount: number): number {
  const paid = Math.min(amount, seat.stack)
  seat.stack -= paid
  seat.bet += paid
  return paid
}

export function startHand(w: PokerWorld): void {
  const live = w.seats.filter((seat) => !seat.out)
  if (live.length <= 1) {
    w.phase = { at: 'over' }
    w.actor = null
    w.actBy = null
    return
  }
  w.saved = {
    seed: w.seed,
    seats: w.seats.map(({ player, stack, out }) => ({ player, stack, out })),
    busted: w.busted.map((row) => ({ ...row })),
    button: w.button,
    handNo: w.handNo + 1,
    elapsed: w.elapsedBase + w.tick,
  }
  const level = levelOf(w)
  if (level.bb !== w.bb) feed(w, { player: null, kind: 'level', amount: level.bb })
  w.bb = level.bb
  w.sb = Math.floor(level.bb / 2)
  w.handNo++
  for (const seat of w.seats) {
    Object.assign(seat, { hole: null, bet: 0, contributed: 0, folded: false, acted: false, mayRaise: true, faceUp: false, startStack: seat.stack })
  }
  // ponytail: the button simply moves to the next seat with chips, no dead-button rule; add one if a regular table asks.
  w.button = next(w, w.button, (seat) => !seat.out)
  const sbSeat = live.length === 2 ? w.button : next(w, w.button, (seat) => !seat.out)
  w.sbSeat = sbSeat
  w.bbSeat = next(w, sbSeat, (seat) => !seat.out)
  w.board = []
  w.deck = handDeck(w.seed, w.handNo)
  for (const seat of live) seat.hole = [w.deck.shift()!, w.deck.shift()!]
  w.street = 'preflop'
  w.pots = []
  w.showdown = null
  w.runout = false
  w.equity = null
  w.actor = null
  w.actBy = null
  feed(w, { player: w.seats[sbSeat].player, kind: 'blind', amount: pay(w, w.seats[sbSeat], w.sb) })
  feed(w, { player: w.seats[w.bbSeat].player, kind: 'blind', amount: pay(w, w.seats[w.bbSeat], w.bb) })
  w.highBet = w.bb
  w.raiseSize = w.bb
  w.phase = { at: 'deal', until: w.tick + ticks(PACE.dealMs) }
}

/** Whose turn follows `from`, or -1 when the street is done. */
function nextActor(w: PokerWorld, from: number): number {
  const bettors = w.seats.filter(canBet)
  // A lone player with chips who owes nothing has nobody to bet against.
  if (bettors.length === 1 && bettors[0].bet >= w.highBet) return -1
  if (bettors.length === 0) return -1
  return next(w, from, (seat) => canBet(seat) && (!seat.acted || seat.bet < w.highBet))
}

function setActor(w: PokerWorld, from: number): void {
  const i = nextActor(w, from)
  if (i < 0) return closeStreet(w)
  w.actor = i
  w.actBy = w.tick + ticks(w.seats[i].connected ? w.opts.shotSec * 1000 : PACE.awayShotMs)
  w.phase = { at: 'bet' }
}

export function legal(w: PokerWorld, player: PlayerId): Legal | null {
  if (w.phase.at !== 'bet' || w.actor === null || w.seats[w.actor].player !== player) return null
  const seat = w.seats[w.actor]
  const owe = w.highBet - seat.bet
  const maxTo = seat.bet + seat.stack
  return {
    canCheck: owe <= 0,
    call: Math.min(Math.max(0, owe), seat.stack),
    canRaise: seat.mayRaise && maxTo > w.highBet,
    minTo: Math.min(w.highBet + w.raiseSize, maxTo),
    maxTo,
  }
}

function raiseTo(w: PokerWorld, seat: Seat, to: number): void {
  const opening = w.highBet === 0
  const increment = to - w.highBet
  pay(w, seat, to - seat.bet)
  w.highBet = to
  if (increment >= w.raiseSize) {
    w.raiseSize = increment
    for (const other of w.seats) if (other !== seat && canBet(other)) { other.acted = false; other.mayRaise = true }
  } else {
    // A short all-in: whoever owes must act again, but may only call or fold.
    for (const other of w.seats) if (other !== seat && canBet(other) && other.bet < to) other.acted = false
  }
  feed(w, { player: seat.player, kind: seat.stack === 0 ? 'allIn' : opening ? 'bet' : 'raise', amount: to })
}

/** `auto` marks an action the shot clock took. */
export function act(w: PokerWorld, player: PlayerId, action: PokerAction, auto = false): InputOutcome {
  if (action.kind === 'show') {
    if (w.phase.at !== 'muck' || w.phase.winner !== player || w.phase.shown) return NO
    w.phase.shown = true
    w.seats.find((seat) => seat.player === player)!.faceUp = true
    feed(w, { player, kind: 'show' })
    return OK
  }
  const options = legal(w, player)
  if (!options) return NO
  const seat = w.seats[w.actor!]
  switch (action.kind) {
    case 'fold':
      seat.folded = true
      feed(w, { player, kind: 'fold', ...(action.flick ? { flick: action.flick } : {}), ...(auto ? { auto } : {}) })
      break
    case 'check':
      if (!options.canCheck) return NO
      feed(w, { player, kind: 'check', ...(auto ? { auto } : {}) })
      break
    case 'call': {
      if (options.canCheck) return NO
      pay(w, seat, options.call)
      feed(w, { player, kind: seat.stack === 0 ? 'allIn' : 'call', amount: seat.bet })
      break
    }
    case 'raise':
      if (!Number.isInteger(action.to)) return INVALID
      if (!options.canRaise || action.to < options.minTo || action.to > options.maxTo) return NO
      raiseTo(w, seat, action.to)
      break
    case 'allIn':
      if (options.maxTo > w.highBet) {
        if (!options.canRaise) return NO
        raiseTo(w, seat, options.maxTo)
      } else {
        pay(w, seat, seat.stack)
        feed(w, { player, kind: 'allIn', amount: seat.bet })
      }
      break
  }
  seat.acted = true
  seat.mayRaise = false
  const left = w.seats.filter(inHand)
  if (left.length === 1) return endByFold(w, left[0]), OK
  setActor(w, w.actor!)
  return OK
}

function gather(w: PokerWorld): void {
  for (const seat of w.seats) {
    seat.contributed += seat.bet
    seat.bet = 0
    seat.acted = false
    seat.mayRaise = true
  }
  w.highBet = 0
  w.raiseSize = w.bb
  w.actor = null
  w.actBy = null
  const dealt = w.seats.filter((seat) => seat.hole)
  w.pots = buildPots(
    Object.fromEntries(dealt.map((seat) => [seat.player, seat.contributed])),
    dealt.filter((seat) => seat.folded).map((seat) => seat.player),
  )
}

function closeStreet(w: PokerWorld): void {
  gather(w)
  if (w.street === 'river') return showdown(w)
  if (w.seats.filter(canBet).length <= 1) {
    w.runout = true
    for (const seat of w.seats) if (inHand(seat)) seat.faceUp = true
    updateEquity(w)
    w.phase = { at: 'runout', until: w.tick + ticks(PACE.runoutMs) }
    return
  }
  w.phase = { at: 'reveal', until: w.tick + ticks(PACE.revealMs) }
}

function dealStreet(w: PokerWorld): void {
  const count = w.board.length === 0 ? 3 : 1
  w.board.push(...w.deck.splice(0, count))
  w.street = w.board.length === 3 ? 'flop' : w.board.length === 4 ? 'turn' : 'river'
}

function updateEquity(w: PokerWorld): void {
  const hands = Object.fromEntries(w.seats.filter(inHand).map((seat) => [seat.player, seat.hole!]))
  w.equity = equity(hands, w.board, mulberry32((w.seed ^ Math.imul(w.handNo, 31) ^ w.board.length) >>> 0))
}

/** Pays out and empties the hand's contributions; `hands` names each winner's hand at a showdown. */
function award(w: PokerWorld, won: Record<PlayerId, number>, hands: Record<PlayerId, string> = {}): void {
  for (const seat of w.seats) seat.contributed = 0
  for (const [player, amount] of Object.entries(won)) {
    w.seats.find((seat) => seat.player === player)!.stack += amount
    feed(w, { player, kind: 'win', amount, ...(hands[player] ? { hand: hands[player] } : {}) })
  }
}

function showdown(w: PokerWorld): void {
  const contenders = w.seats.filter(inHand)
  const scored = Object.fromEntries(contenders.map((seat) => [seat.player, best([...seat.hole!, ...w.board])]))
  const scores = Object.fromEntries(Object.entries(scored).map(([id, s]) => [id, s.score]))
  for (const seat of contenders) seat.faceUp = true
  w.showdown = w.pots.filter((pot) => pot.eligible.length > 1).map((pot) => {
    const top = pot.eligible.reduce((a, b) => compare(scores[b], scores[a]) > 0 ? b : a)
    const winners = pot.eligible.filter((id) => compare(scores[id], scores[top]) === 0)
    return { winners, name: scored[top].name, five: scored[top].five, amount: pot.amount }
  })
  award(w, awardPots(w.pots, scores, leftOfButton(w)), Object.fromEntries(Object.entries(scored).map(([id, s]) => [id, s.name])))
  w.equity = null
  w.phase = { at: 'showdown', until: w.tick + ticks(PACE.showdownMs) }
}

function endByFold(w: PokerWorld, winner: Seat): void {
  gather(w)
  const total = w.pots.reduce((sum, pot) => sum + pot.amount, 0)
  award(w, { [winner.player]: total })
  w.phase = { at: 'muck', until: w.tick + ticks(PACE.muckMs), winner: winner.player, shown: false }
}

/**
 * Players left with no chips go out. Several out in one hand are placed by
 * their stacks as it began, larger first; equal stacks share the place.
 */
function finishHand(w: PokerWorld): void {
  const live = w.seats.filter((seat) => !seat.out)
  const gone = live.filter((seat) => seat.stack === 0).sort((a, b) => b.startStack - a.startStack)
  const firstPlace = live.length - gone.length + 1
  for (const seat of gone) {
    const place = firstPlace + gone.filter((other) => other.startStack > seat.startStack).length
    seat.out = true
    w.busted.push({ player: seat.player, place })
    feed(w, { player: seat.player, kind: 'bust', amount: place })
  }
  startHand(w)
}

export function levelOf(w: PokerWorld): { level: number; bb: number; nextAtTick: number } {
  const per = ticks(w.opts.levelMin * 60_000)
  const level = Math.floor((w.elapsedBase + w.tick) / per)
  return { level, bb: w.opts.bigBlind * 2 ** level, nextAtTick: (level + 1) * per - w.elapsedBase }
}

export function setPresence(w: PokerWorld, connected: PlayerId[]): void {
  for (const seat of w.seats) seat.connected = connected.includes(seat.player)
  // Someone who drops on their turn gets the short clock from now.
  if (w.actor !== null && !w.seats[w.actor].connected && w.actBy !== null) {
    w.actBy = Math.min(w.actBy, w.tick + ticks(PACE.awayShotMs))
  }
}

export const finished = (w: PokerWorld) => w.phase.at === 'over'

/** Everyone's finishing place; whoever is still seated is first. */
export function places(w: PokerWorld): { playerId: PlayerId; place: number }[] {
  return [
    ...w.seats.filter((seat) => !seat.out).map((seat) => ({ playerId: seat.player, place: 1 })),
    ...[...w.busted].sort((a, b) => a.place - b.place).map((row) => ({ playerId: row.player, place: row.place })),
  ]
}

export function stepTable(w: PokerWorld): void {
  w.tick++
  const phase = w.phase
  if (phase.at === 'over') return
  if (phase.at === 'bet') {
    if (w.actBy === null || w.tick < w.actBy) return
    const player = w.seats[w.actor!].player
    act(w, player, { kind: legal(w, player)!.canCheck ? 'check' : 'fold' }, true)
    return
  }
  if (w.tick < phase.until) return
  switch (phase.at) {
    case 'deal':
      return setActor(w, w.street === 'preflop' ? w.bbSeat : w.button)
    case 'reveal':
      dealStreet(w)
      return setActor(w, w.button)
    case 'runout':
      dealStreet(w)
      if (w.board.length === 5) return showdown(w)
      updateEquity(w)
      w.phase = { at: 'runout', until: w.tick + ticks(PACE.runoutMs) }
      return
    case 'showdown':
    case 'muck':
      return finishHand(w)
  }
}
