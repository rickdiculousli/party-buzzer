import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../../../shared/random.ts'
import { act, createTable, finished, legal, places, resumeTable, setPresence, startHand, stepTable, tableCheckpoint, STEP_MS, PACE } from './table.ts'
import type { PokerWorld, Seat } from './types.ts'

const OPTS = { stack: 1500, bigBlind: 20, levelMin: 10, shotSec: 30 }
const seatOf = (w: PokerWorld, id: string) => w.seats.find((seat) => seat.player === id)!
const actorId = (w: PokerWorld) => w.seats[w.actor!].player
const at = (w: PokerWorld, offset: number) => w.seats[(w.button + offset) % w.seats.length]
const run = (w: PokerWorld, ms: number) => { for (let i = 0; i < ms / STEP_MS; i++) stepTable(w) }
const untilBet = (w: PokerWorld) => { for (let i = 0; i < 2_000 && w.phase.at !== 'bet'; i++) stepTable(w) }
const until = (w: PokerWorld, phase: string) => { for (let i = 0; i < 2_000 && w.phase.at !== phase; i++) stepTable(w) }
const chips = (w: PokerWorld) => w.seats.reduce((sum, seat) => sum + seat.stack + seat.bet + seat.contributed, 0)
/** Deals chosen hole cards and a chosen board over whatever the shuffle gave. */
function rig(w: PokerWorld, holes: Record<string, [string, string]>, board: string[]) {
  for (const [id, hole] of Object.entries(holes)) seatOf(w, id).hole = hole
  w.deck = [...board]
}
function setStack(seat: Seat, total: number) { seat.stack = total - seat.bet; seat.startStack = total }

test('blinds post and preflop action starts left of the big blind', () => {
  const w = createTable(1, ['a', 'b', 'c', 'd'], OPTS)
  assert.equal(at(w, 1).bet, 10)
  assert.equal(at(w, 1).stack, 1490)
  assert.equal(at(w, 2).bet, 20)
  assert.equal(at(w, 2).stack, 1480)
  for (const seat of w.seats) assert.equal(seat.hole?.length, 2)
  untilBet(w)
  assert.equal(actorId(w), at(w, 3).player)
})

test('min raise: a raise below highBet + raiseSize is refused, all in is always allowed', () => {
  const w = createTable(2, ['a', 'b', 'c', 'd'], OPTS)
  untilBet(w)
  const first = actorId(w)
  assert.equal(legal(w, first)!.minTo, 40)
  assert.deepEqual(act(w, first, { kind: 'raise', to: 39 }), { status: 'refused', reason: 'not-allowed' })
  assert.deepEqual(act(w, first, { kind: 'raise', to: 40 }), { status: 'accepted' })
  const second = actorId(w)
  seatOf(w, second).stack = 25
  assert.deepEqual(act(w, second, { kind: 'allIn' }), { status: 'accepted' })
  assert.equal(seatOf(w, second).stack, 0)
})

test('a short all-in does not reopen betting', () => {
  const w = createTable(3, ['a', 'b', 'c', 'd'], OPTS)
  untilBet(w)
  const raiser = actorId(w)
  act(w, raiser, { kind: 'raise', to: 100 })
  const shorty = seatOf(w, actorId(w))
  setStack(shorty, 150)
  act(w, shorty.player, { kind: 'allIn' })
  act(w, actorId(w), { kind: 'call' })
  act(w, actorId(w), { kind: 'call' })
  assert.equal(actorId(w), raiser)
  const options = legal(w, raiser)!
  assert.equal(options.canRaise, false)
  assert.equal(options.call, 50)
  assert.equal(options.canAllIn, false, 'all in would be a raise it may not make')
})

test('street closes when all have acted and matched; the next street starts left of the button', () => {
  const w = createTable(4, ['a', 'b', 'c'], OPTS)
  untilBet(w)
  act(w, actorId(w), { kind: 'call' })
  act(w, actorId(w), { kind: 'call' })
  act(w, actorId(w), { kind: 'check' })
  assert.equal(w.board.length, 0)
  untilBet(w)
  assert.equal(w.street, 'flop')
  assert.equal(w.board.length, 3)
  assert.equal(actorId(w), at(w, 1).player)
  assert.equal(w.pots[0].amount, 60)
})

test('everyone folds to a raise: winner takes the pot and phase is muck; show sets faceUp', () => {
  const w = createTable(5, ['a', 'b', 'c'], OPTS)
  untilBet(w)
  const raiser = actorId(w)
  act(w, raiser, { kind: 'raise', to: 60 })
  act(w, actorId(w), { kind: 'fold', flick: { dx: 0, dy: -1, speed: 0.7 } })
  act(w, actorId(w), { kind: 'fold' })
  assert.equal(w.phase.at, 'muck')
  assert.equal(seatOf(w, raiser).stack, 1500 + 30)
  assert.equal(w.feed.some((entry) => entry.kind === 'fold' && entry.flick?.speed === 0.7), true)
  assert.deepEqual(act(w, raiser, { kind: 'show' }), { status: 'accepted' })
  assert.equal(seatOf(w, raiser).faceUp, true)
})

test('uncalled bet returns: all in for 500 against a 200 all in pays 300 back before showdown', () => {
  const w = createTable(6, ['a', 'b'], OPTS)
  setStack(seatOf(w, 'a'), 500)
  setStack(seatOf(w, 'b'), 200)
  rig(w, { a: ['7c', '2d'], b: ['Ah', 'As'] }, ['3s', '8h', 'Td', 'Jc', '4d'])
  untilBet(w)
  while (w.phase.at === 'bet') act(w, actorId(w), { kind: 'allIn' })
  until(w, 'showdown')
  assert.equal(seatOf(w, 'a').stack, 300)
  assert.equal(seatOf(w, 'b').stack, 400)
  assert.equal(w.feed.some((entry) => entry.kind === 'win' && entry.player === 'a'), false, 'a refund is not a win')
})

test('showdown awards side pots to different winners', () => {
  const w = createTable(7, ['a', 'b', 'c'], OPTS)
  setStack(seatOf(w, 'a'), 100)
  setStack(seatOf(w, 'b'), 500)
  setStack(seatOf(w, 'c'), 500)
  rig(w, { a: ['Ah', 'As'], b: ['Kh', 'Ks'], c: ['7c', '2d'] }, ['3s', '8h', 'Td', 'Jc', '4d'])
  untilBet(w)
  while (w.phase.at === 'bet') act(w, actorId(w), { kind: 'allIn' })
  until(w, 'showdown')
  assert.equal(seatOf(w, 'a').stack, 300)
  assert.equal(seatOf(w, 'b').stack, 800)
  assert.equal(seatOf(w, 'c').stack, 0)
  assert.equal(w.showdown![0].name, 'Pair of aces')
})

test('heads-up after a bust: button posts small blind and acts first preflop', () => {
  const w = createTable(8, ['a', 'b', 'c'], OPTS)
  const gone = w.seats.find((seat, i) => i !== w.button)!
  gone.out = true
  gone.stack = 0
  startHand(w)
  const button = w.seats[w.button]
  assert.notEqual(button, gone)
  assert.equal(button.bet, 10)
  untilBet(w)
  assert.equal(actorId(w), button.player)
  act(w, button.player, { kind: 'call' })
  act(w, actorId(w), { kind: 'check' })
  untilBet(w)
  assert.notEqual(actorId(w), button.player)
})

test('a second action after the turn passed is refused and changes nothing', () => {
  const w = createTable(9, ['a', 'b', 'c'], OPTS)
  untilBet(w)
  const first = actorId(w)
  act(w, first, { kind: 'call' })
  const before = JSON.stringify(w)
  assert.deepEqual(act(w, first, { kind: 'call' }), { status: 'refused', reason: 'not-allowed' })
  assert.deepEqual(act(w, first, { kind: 'fold' }), { status: 'refused', reason: 'not-allowed' })
  assert.equal(JSON.stringify(w), before)
})

/** A bot that picks a random legal action. */
function botMove(w: PokerWorld, rand: () => number) {
  const id = actorId(w)
  const options = legal(w, id)!
  const roll = rand()
  if (roll < 0.2 && !options.canCheck) return act(w, id, { kind: 'fold' })
  if (roll < 0.75) return act(w, id, { kind: options.canCheck ? 'check' : 'call' })
  if (roll < 0.95 && options.canRaise) return act(w, id, { kind: 'raise', to: options.minTo })
  return act(w, id, { kind: 'allIn' })
}

test('chips are conserved', () => {
  const rand = mulberry32(9)
  const w = createTable(9, ['a', 'b', 'c', 'd', 'e', 'f'], OPTS)
  const total = 6 * OPTS.stack
  for (let i = 0; i < 500_000 && w.handNo <= 200 && w.phase.at !== 'over'; i++) {
    if (w.phase.at === 'bet') assert.equal(botMove(w, rand).status, 'accepted')
    else stepTable(w)
    assert.equal(chips(w), total, `hand ${w.handNo}`)
  }
  assert.ok(w.handNo > 20)
})

test('shot clock checks when free, folds when owing', () => {
  const w = createTable(10, ['a', 'b', 'c'], OPTS)
  untilBet(w)
  const slow = actorId(w)
  run(w, OPTS.shotSec * 1000 + STEP_MS)
  assert.deepEqual(w.feed.at(-1), { id: w.feed.at(-1)!.id, player: slow, kind: 'fold', auto: true })
  act(w, actorId(w), { kind: 'call' })
  if (w.phase.at === 'bet') act(w, actorId(w), { kind: 'check' })
  untilBet(w)
  const free = actorId(w)
  run(w, OPTS.shotSec * 1000 + STEP_MS)
  assert.deepEqual(w.feed.at(-1), { id: w.feed.at(-1)!.id, player: free, kind: 'check', auto: true })
})

test('disconnected seat is auto-acted within 2 s and blinds keep posting', () => {
  const rand = mulberry32(4)
  const w = createTable(11, ['a', 'b', 'c', 'd'], OPTS)
  setPresence(w, ['b', 'c', 'd'])
  let waited = 0
  for (let i = 0; i < 200_000 && w.handNo < 20 && w.phase.at !== 'over'; i++) {
    if (w.phase.at === 'bet' && actorId(w) !== 'a') { botMove(w, rand); waited = 0; continue }
    waited = w.phase.at === 'bet' ? waited + 1 : 0
    assert.ok(waited <= PACE.awayShotMs / STEP_MS + 1, 'stalled on the away seat')
    stepTable(w)
  }
  assert.ok(w.handNo >= 20 || seatOf(w, 'a').out)
  assert.ok(w.feed.length > 0)
})

test('a level change applies at the next hand, not mid-hand', () => {
  const w = createTable(12, ['a', 'b', 'c'], { ...OPTS, levelMin: 1 })
  untilBet(w)
  w.elapsedBase = 60_000 / STEP_MS
  act(w, actorId(w), { kind: 'fold' })
  act(w, actorId(w), { kind: 'fold' })
  assert.equal(w.bb, 20)
  until(w, 'deal')
  assert.equal(w.bb, 40)
  assert.equal(w.sb, 20)
  assert.ok(w.feed.some((entry) => entry.kind === 'level' && entry.amount === 40))
})

/** Five seats; a and b bust together against c's aces while d and e fold. */
function doubleBust(aStack: number, bStack: number) {
  const w = createTable(13, ['a', 'b', 'c', 'd', 'e'], OPTS)
  setStack(seatOf(w, 'a'), aStack)
  setStack(seatOf(w, 'b'), bStack)
  setStack(seatOf(w, 'c'), 3000)
  rig(w, { a: ['7c', '2d'], b: ['8c', '3d'], c: ['Ah', 'As'] }, ['4s', '9h', 'Td', 'Jc', 'Kd'])
  untilBet(w)
  while (w.phase.at === 'bet') act(w, actorId(w), { kind: ['d', 'e'].includes(actorId(w)) ? 'fold' : 'allIn' })
  until(w, 'deal')
  return w
}

test('busts are placed by hand-start stack, ties share', () => {
  assert.deepEqual(doubleBust(300, 800).busted, [{ player: 'b', place: 4 }, { player: 'a', place: 5 }])
  assert.deepEqual(doubleBust(500, 500).busted, [{ player: 'a', place: 4 }, { player: 'b', place: 4 }])
})

test('the match ends with one stack', () => {
  const rand = mulberry32(5)
  const w = createTable(14, ['a', 'b', 'c', 'd', 'e', 'f'], { ...OPTS, levelMin: 1 })
  for (let i = 0; i < 2_000_000 && !finished(w); i++) {
    if (w.phase.at === 'bet') botMove(w, rand)
    else stepTable(w)
  }
  assert.ok(finished(w))
  const result = places(w)
  const winner = w.seats.find((seat) => !seat.out)!
  assert.equal(winner.stack, 6 * OPTS.stack)
  assert.equal(result.find((row) => row.place === 1)?.playerId, winner.player)
  assert.equal(result.length, 6)
})

test('resume after a mid-hand stop restores hand-start stacks', () => {
  const deep = { ...OPTS, stack: 100_000 }
  const w = createTable(15, ['a', 'b', 'c'], deep)
  for (let i = 0; i < 500_000 && w.handNo < 12; i++) {
    if (w.phase.at === 'bet') act(w, actorId(w), { kind: legal(w, actorId(w))!.canCheck ? 'check' : 'call' })
    else stepTable(w)
  }
  assert.equal(w.phase.at, 'deal')
  const saved = tableCheckpoint(w)!
  assert.equal(saved.version, 12)
  assert.equal(saved.label, 'hand 12')
  const startStacks = Object.fromEntries(w.seats.map((seat) => [seat.player, seat.startStack]))
  const holes = Object.fromEntries(w.seats.map((seat) => [seat.player, seat.hole]))
  const button = w.button
  untilBet(w)
  act(w, actorId(w), { kind: 'raise', to: legal(w, actorId(w))!.minTo })
  const back = resumeTable(JSON.parse(JSON.stringify(saved.data)), deep)
  assert.equal(back.handNo, 12)
  assert.equal(back.button, button)
  assert.deepEqual(Object.fromEntries(back.seats.map((seat) => [seat.player, seat.startStack])), startStacks)
  assert.deepEqual(Object.fromEntries(back.seats.map((seat) => [seat.player, seat.hole])), holes)
  assert.equal(back.feed.some((entry) => entry.kind === 'level'), false)
})

test('a short all-in big blind wins only what it matched when everyone folds', () => {
  const w = createTable(16, ['a', 'b', 'c'], OPTS)
  const bbSeat = w.seats[w.bbSeat]
  const sbSeat = w.seats[w.sbSeat]
  // Rebuild the blinds: the big blind posted all in for 5.
  sbSeat.stack = 990; sbSeat.bet = 10
  bbSeat.stack = 0; bbSeat.bet = 5
  untilBet(w)
  while (w.phase.at === 'bet') act(w, actorId(w), { kind: 'fold' })
  assert.equal(bbSeat.stack, 10, 'wins its own 5 and the 5 it matched')
  assert.equal(sbSeat.stack, 995, 'gets back the 5 nobody matched')
})

test('a player who comes back on their turn gets the full clock again', () => {
  const w = createTable(17, ['a', 'b', 'c'], OPTS)
  untilBet(w)
  const id = actorId(w)
  setPresence(w, ['a', 'b', 'c'].filter((p) => p !== id))
  run(w, 500)
  setPresence(w, ['a', 'b', 'c'])
  run(w, PACE.awayShotMs)
  assert.equal(actorId(w), id, 'still their turn')
})
