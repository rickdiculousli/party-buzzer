import test from 'node:test'
import assert from 'node:assert/strict'
import { bump, closestAwards, leaderValue, lockedPlayerIds, resumeReveal, revealHeldAt, revealProgress, revealValue, scoreKey } from './scoring.ts'
import type { Round } from './protocol.ts'

test('scoring and lockouts use the same team key while unassigned players remain independent', () => {
  const players = [
    { id: 'ada', name: 'Ada', connected: true, teamId: 'red' },
    { id: 'bo', name: 'Bo', connected: true, teamId: 'red' },
    { id: 'cy', name: 'Cy', connected: true },
  ]
  const round: Round = {
    questionId: '', attemptId: '', armedAt: 0, value: 100,
    phase: 'IDLE', order: [], total: 0, lockedOut: ['red'],
  }
  const teamState = { players, grouping: 'teams' as const, round, scores: {} as Record<string, number> }
  bump(teamState, scoreKey(teamState, 'ada'), 200)
  bump(teamState, scoreKey(teamState, 'bo'), -50)
  bump(teamState, scoreKey(teamState, 'cy'), 100)
  assert.deepEqual(teamState.scores, { red: 150, cy: 100 })
  assert.deepEqual(lockedPlayerIds(teamState), ['ada', 'bo'])
  const solo = { ...teamState, grouping: 'solo' as const }
  assert.equal(scoreKey(solo, 'ada'), 'ada')
  assert.deepEqual(lockedPlayerIds(solo), [], 'team penalties do not bar solo players')
})

test('closest: the nearest takes the value; fewer than six guessers pay no second place', () => {
  assert.deepEqual(closestAwards({ ada: 1700, bo: 1200, cy: 1500 }, 1665, 200), { ada: 200 })
  // Under or over makes no difference.
  assert.deepEqual(closestAwards({ ada: 1600, bo: 1700 }, 1665, 200), { bo: 200 })
  assert.deepEqual(closestAwards({}, 1665, 200), {})
})

test('closest: ties share, an exact hit doubles, and the shares round to whole points', () => {
  assert.deepEqual(closestAwards({ ada: 1600, bo: 1730, cy: 1000 }, 1665, 200), { ada: 100, bo: 100 })
  assert.deepEqual(closestAwards({ ada: 1665, bo: 1666 }, 1665, 200), { ada: 400 })
  // Two exact hits share the doubled pot.
  assert.deepEqual(closestAwards({ ada: 1665, bo: 1665, cy: 1 }, 1665, 200), { ada: 200, bo: 200 })
  assert.deepEqual(closestAwards({ a: 10, b: 10, c: 10 }, 9, 200), { a: 67, b: 67, c: 67 })
  // 1.1 and 0.9 are the same distance from 1, floating point or not.
  assert.deepEqual(closestAwards({ a: 1.1, b: 0.9 }, 1, 200), { a: 100, b: 100 })
})

test('closest: with six or more guessers the next-nearest takes half', () => {
  const nine = { ada: 1500, bo: 1200, cy: 1700, di: 900, ed: 3000, fen: 1500, gus: 500, hal: 100, ivy: 20000 }
  assert.deepEqual(closestAwards(nine, 1665, 200), { cy: 200, ada: 50, fen: 50 })
  const five = { ada: 1500, bo: 1200, cy: 1700, di: 900, ed: 3000 }
  assert.deepEqual(closestAwards(five, 1665, 200), { cy: 200 })
  // An exact hit doubles first place only.
  assert.deepEqual(closestAwards({ ...five, fen: 1665 }, 1665, 200), { fen: 400, cy: 100 })
})

test('a picture reveal pays double in its first quarter and a quarter less each quarter after', () => {
  const reveal = { from: 1000, until: 11_000 }
  const at = (ms: number) => revealValue(200, reveal, ms)
  assert.equal(at(0), 400, 'a press before the reveal starts (a steal pinned to the arm) is the first quarter')
  assert.equal(at(1000), 400)
  assert.equal(at(3499), 400)
  assert.equal(at(3500), 350, 'the boundary belongs to the next quarter')
  assert.equal(at(4000), 350, 'three seconds in')
  assert.equal(at(6000), 300)
  assert.equal(at(8500), 250)
  assert.equal(at(10_999), 250)
  assert.equal(at(11_000), 200, 'sharp pays the plain value')
  assert.equal(at(60_000), 200, 'and so does any time after')
  assert.equal(revealValue(300, reveal, 4000), 525, 'rounded to whole points')
})

test('a held reveal resumes from where it stood, and the leader is paid by the press', () => {
  const held = { from: 1000, until: 11_000, heldAt: 4000 }
  const resumed = resumeReveal(held, 20_000)
  assert.deepEqual(resumed, { from: 17_000, until: 27_000 })
  assert.equal(revealProgress(resumed, 20_000), revealProgress(held, 4000))
  assert.deepEqual(resumeReveal({ from: 1000, until: 11_000 }, 20_000), { from: 1000, until: 11_000 }, 'nothing held, nothing moves')
  // A miss after the picture was sharp resumes sharp, never past it.
  assert.deepEqual(resumeReveal({ from: 0, until: 10_000, heldAt: 15_000 }, 20_000), { from: 10_000, until: 20_000 })

  const order = [{ playerId: 'a', name: 'A', at: 22_600, deltaMs: 0 }]
  assert.equal(leaderValue({ value: 200, reveal: resumed, order }), 300, 'the rebound press is read against the resumed clock')
  assert.equal(leaderValue({ value: 200, order }), 200, 'no reveal, the round value')
  assert.equal(revealHeldAt({ reveal: resumed, order }), 22_600, 'the leader holds the picture')
  assert.equal(revealHeldAt({ reveal: held, order: [] }), 4000, 'a miss holds it with nobody in the order')
  assert.equal(revealHeldAt({ reveal: resumed, order: [] }), undefined, 'refining')
})
