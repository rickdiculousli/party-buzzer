import test from 'node:test'
import assert from 'node:assert/strict'
import { allGuessed, CLOSEST_REVEAL, closestTimes, formatNumber, lineScale, placeOn, scoresBeforeClosest } from './closest.ts'
import type { State } from './protocol.ts'

function room(): State {
  return {
    players: [
      { id: 'ada', name: 'Ada', connected: true },
      { id: 'bo', name: 'Bo', connected: true },
    ],
    effects: [],
    round: { questionId: 'q', attemptId: 'a', armedAt: 0, value: 200, phase: 'ARMED', order: [], total: 0, lockedOut: [], kind: 'closest' },
  } as unknown as State
}

test('everyone has guessed once every connected picker has, and a dropped phone does not hold it open', () => {
  const s = room()
  s.round.guesses = { ada: 10 }
  assert.equal(allGuessed(s), false)
  s.players[1].connected = false
  assert.equal(allGuessed(s), true, 'Bo left; Ada was the last one in')
  s.players[0].connected = false
  assert.equal(allGuessed(s), false, 'an empty room waits for the timer')
})

test('the line covers the answer and the guesses, with a margin', () => {
  const scale = lineScale([1700, 1200, 1500], 1665)
  assert.ok(scale.lo < 1200 && scale.hi > 1700)
  for (const g of [1700, 1200, 1500, 1665]) assert.equal(placeOn(scale, g).parked, undefined)
  // The answer outside every guess is still on the line.
  const past = lineScale([10, 20], 100)
  assert.ok(past.hi > 100 && past.lo < 10)
})

test('one wild guess is parked at the end rather than squashing the rest', () => {
  const scale = lineScale([1500, 1200, 1700, 1800, 1000000], 1665)
  assert.ok(scale.hi < 3000)
  assert.deepEqual(placeOn(scale, 1000000), { at: 1, parked: 'high' })
  const low = lineScale([900000, 950000, 1000000, 10], 980000)
  assert.equal(placeOn(low, 10).parked, 'low')
  // A guess that is merely far keeps its place.
  assert.equal(placeOn(lineScale([1500, 1200, 1700, 1800, 600], 1665), 600).parked, undefined)
  // A dozen crowding the answer push a far one off the end, so they get the line.
  const piano = [88, 88, 88, 52, 76, 80, 85, 90, 96, 100, 120, 300]
  assert.equal(placeOn(lineScale(piano, 88), 300).parked, 'high')
  // Two jokers at one end go together once the room is big enough to cap two.
  const room = Array.from({ length: 20 }, (_, i) => 5 + i)
  const both = lineScale([...room, 1e6, 2e6], 10)
  assert.ok(both.hi < 100)
  assert.equal(placeOn(both, 1e6).parked, 'high')
  // Two guesses are not a crowd to protect.
  assert.equal(placeOn(lineScale([1500, 1000000], 1665), 1000000).parked, undefined)
})

test('every guess and the answer agreeing still draws a line', () => {
  const scale = lineScale([7, 7], 7)
  assert.ok(scale.lo < 7 && scale.hi > 7)
  assert.equal(placeOn(scale, 7).at, 0.5)
  assert.ok(lineScale([0], 0).hi > 0)
})

test('numbers are spelt as the room writes them', () => {
  assert.equal(formatNumber(1665), '1,665')
  assert.equal(formatNumber(0.25), '0.25')
})

test('a year spelt plain keeps no comma', () => {
  assert.equal(formatNumber(1989, true), '1989')
  assert.equal(formatNumber(1989), '1,989')
})

test('the reveal lights after the answer runs in, and the stamp after that', () => {
  const t = closestTimes(7)
  assert.ok(t.truthAt < t.lightAt && t.lightAt < t.stampAt && t.stampAt < t.doneAt)
  assert.equal(closestTimes(8).truthAt - t.truthAt, CLOSEST_REVEAL.landStepMs, 'one step per guess')
  assert.equal(closestTimes(0).truthAt, closestTimes(1).truthAt)
})

test('the scores before a closest question paid', () => {
  const s = room()
  s.grouping = 'teams'
  s.players[0].teamId = 'red'
  s.scores = { red: 300, bo: 100 }
  s.round.paid = { ada: 200, bo: 100 }
  assert.deepEqual(scoresBeforeClosest(s), { red: 100, bo: 0 })
})
