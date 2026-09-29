import test from 'node:test'
import assert from 'node:assert/strict'
import { poker } from './definition.ts'
import { act, legal, stepTable } from './table.ts'
import type { PokerWorld } from './types.ts'

const clock = (worldMs: number) => 1_000 + worldMs
const lobby = { teams: {}, volunteers: [] }
const OPTS = { durationSec: 40, seed: 3, stack: 1500, bigBlind: 20, levelMin: 10, shotSec: 30 }
const start = (players = ['a', 'b', 'c']) => poker.create(3, players, OPTS, lobby).world as PokerWorld
const untilBet = (w: PokerWorld) => { for (let i = 0; i < 2_000 && w.phase.at !== 'bet'; i++) poker.step(w) }
const actorId = (w: PokerWorld) => w.seats[w.actor!].player

test('hole cards are private', () => {
  const w = start()
  const holeOf = (id: string) => w.seats.find((seat) => seat.player === id)!.hole!
  const shows = (frame: object | null, id: string) => holeOf(id).every((card) => JSON.stringify(frame).includes(`"${card}"`))
  for (const id of ['a', 'b', 'c']) {
    assert.equal(shows(poker.boardFrame(w, clock), id), false, `board shows ${id}`)
    for (const other of ['a', 'b', 'c']) {
      assert.equal(shows(poker.playerFrame(w, other, clock), id), other === id, `${other} sees ${id}`)
    }
  }
})

test('malformed raise amounts are dropped or refused', () => {
  const w = start()
  untilBet(w)
  const id = actorId(w)
  for (const to of [NaN, Infinity, '100']) assert.equal(poker.classify({ kind: 'raise', to, at: 1 }), null)
  assert.equal(poker.classify({ kind: 'raise', to: 100, at: 1 }), 'discrete')
  assert.equal(poker.classify({ kind: 'dance', at: 1 }), null)
  assert.deepEqual(poker.apply(w, id, { kind: 'raise', to: -5, at: 1 }), { status: 'refused', reason: 'invalid' })
  assert.deepEqual(poker.apply(w, id, { kind: 'raise', to: 12.5, at: 1 }), { status: 'refused', reason: 'invalid' })
  assert.deepEqual(poker.apply(w, id, { kind: 'raise', to: 30, at: 1 }), { status: 'refused', reason: 'not-allowed' })
  assert.deepEqual(poker.apply(w, id, { kind: 'raise', to: 99_999, at: 1 }), { status: 'refused', reason: 'not-allowed' })
  assert.deepEqual(poker.apply(w, id, { kind: 'raise', to: legal(w, id)!.minTo, at: 1 }), { status: 'accepted' })
})

test('a fold keeps only a well-formed flick', () => {
  const w = start()
  untilBet(w)
  poker.apply(w, actorId(w), { kind: 'fold', flick: { dx: NaN, dy: -1, speed: 2 }, at: 1 })
  assert.equal(w.feed.at(-1)?.flick, undefined)
  poker.apply(w, actorId(w), { kind: 'fold', flick: { dx: 3, dy: -4, speed: 2 }, at: 1 })
  const folds = w.feed.filter((entry) => entry.kind === 'fold')
  assert.deepEqual(folds.at(-1)?.flick, { dx: 0.6, dy: -0.8, speed: 1 })
})

test('reactions: a busted player may react; a second within 3 s is too-soon', () => {
  const w = start()
  w.seats[0].out = true
  const id = w.seats[0].player
  assert.deepEqual(poker.apply(w, id, { kind: 'react', react: 'wow', at: 1 }), { status: 'accepted' })
  assert.deepEqual(poker.apply(w, id, { kind: 'react', react: 'ouch', at: 1 }), { status: 'refused', reason: 'too-soon' })
  assert.deepEqual(poker.apply(w, id, { kind: 'react', react: 'boo', at: 1 }), { status: 'refused', reason: 'invalid' })
  for (let i = 0; i < 60; i++) stepTable(w)
  assert.deepEqual(poker.apply(w, id, { kind: 'react', react: 'ouch', at: 1 }), { status: 'accepted' })
  assert.deepEqual(w.reactions.map((r) => r.kind), ['wow', 'ouch'])
})

test('results give places and zero points', () => {
  const w = start(['a', 'b'])
  untilBet(w)
  while (w.phase.at === 'bet') act(w, actorId(w), { kind: 'allIn' })
  for (let i = 0; i < 10_000 && !poker.finished!(w); i++) poker.step(w)
  assert.ok(poker.finished!(w))
  const results = poker.results(w)
  assert.deepEqual(results.map((row) => [row.points, row.shots, row.place]).sort(), [[0, 0, 1], [0, 0, 2]])
})

test('a room of one cannot start', () => {
  assert.equal(poker.startable!(lobby, ['a']), 'too-few-players')
  assert.equal(poker.startable!(lobby, ['a', 'b']), null)
})

test('host lines name the hand, the blinds with the next level, and the seats left', () => {
  const w = start()
  const lines = poker.hostStatus!(w, clock)
  assert.deepEqual(lines.map((line) => line.text), ['Hand 1', 'Blinds 10 / 20', '3 seats left'])
  assert.equal(lines[1].until, clock(10 * 60_000))
})
