import test from 'node:test'
import assert from 'node:assert/strict'
import { FINALE_SCHEDULE, finaleCalled, finaleStep, finaleTiers, lastUp, momentOf, phoneOf, wallOf, type Local, type Wall } from './wall.ts'
import type { State } from './protocol.ts'

const LOCAL: Local = { open: false, settled: true, retired: false }

function room(): State {
  return {
    grouping: 'solo',
    readingActive: false,
    players: [
      { id: 'a', name: 'Ada', connected: true },
      { id: 'b', name: 'Bo', connected: true },
    ],
    teams: [],
    scores: { a: 0, b: 0 },
    round: { questionId: '', attemptId: '', value: 200, phase: 'IDLE', armedAt: 0, order: [], total: 0, lockedOut: [] },
    game: { id: 'trivia', options: {}, moduleState: null },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    setlists: [],
    packs: [],
    packSizes: {},
    packCost: {},
    mirrorFragments: false,
    answerWindowSec: 0,
    choiceSec: 20,
    revealSec: 10,
    autoplay: { on: false, nextSec: 4, buzzSec: 4, reboundSec: 3, introSec: 12 },
  }
}

function oneOf(w: Wall, why: string) {
  const up = [w.hero, w.clue, w.nominations, w.faceoff, w.call, w.finale, w.next].filter((x) => x !== null)
  assert.equal(up.length, 1, `${why}: expected one middle-band occupant, got ${up.length} (${w.moment})`)
}

test('a question end to end, one occupant the whole way', () => {
  const s = room()
  const at = (l: Partial<Local> = {}) => {
    const w = wallOf(s, { ...LOCAL, ...l })
    oneOf(w, w.moment)
    return w
  }

  assert.equal(at().moment, 'idle:welcome')
  assert.ok(at().call === 'ready')

  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  assert.equal(at().moment, 'buzz:arming')
  assert.equal(at().next, 200, 'the card holds through the lead')
  assert.equal(at().value, null, 'without the chip repeating it')
  assert.equal(at({ open: true }).moment, 'buzz:open')
  assert.equal(at({ open: true }).call, 'buzz')

  s.round.phase = 'COLLECTING'
  assert.equal(at({ open: true }).moment, 'buzz:collecting')
  assert.equal(at({ open: true }).hero, null, 'no leader before the reveal')
  s.round.order = [{ playerId: 'b', name: 'Bo', at: 1100, deltaMs: 0 }]
  s.round.total = 1
  assert.deepEqual(at().hero, { name: 'Bo', tone: 'answering' })

  s.round.phase = 'LOCKED'
  assert.equal(at().moment, 'answer:locked')

  s.round.spoken = { name: 'Bo', transcript: 'rosalind franklin', hit: false }
  s.round.award = { name: 'Bo', points: -300 }
  s.round.held = true
  const typing = at({ settled: false })
  assert.equal(typing.moment, 'answer:judging', 'the transcript is read before the result')
  assert.deepEqual(typing.hero, { name: 'Bo', tone: 'answering' }, 'neutral until its own verdict')
  assert.equal(typing.clue, null, 'and the clue does not flash back underneath it')

  const held = at()
  assert.equal(held.moment, 'verdict:hold')
  assert.deepEqual(held.hero, { name: 'Bo', tone: 'penalised' })
  assert.equal(held.award?.points, -300)
  assert.equal(held.value, 200, 'the stakes stay in the corner through the miss')

  delete s.round.held
  delete s.round.spoken
  s.round.phase = 'ARMED'
  s.round.armedAt = 5000
  assert.deepEqual(at({ retired: true }).hero, { name: 'Bo', tone: 'penalised' })
  s.readingActive = true
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 4,
    paused: false,
  }
  s.round.whole = 'One. Two. Three.'
  s.round.fragments = ['One.']
  const on = at({ open: true, retired: false })
  assert.equal(on.moment, 'buzz:open')
  assert.equal(on.award, null, 'the stamp does not outlive the voice')
  assert.deepEqual(on.clue, { whole: 'One. Two. Three.', shown: 'One.' })
  assert.equal(on.value, 200, 'what is at stake comes back with it')

  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 5200, deltaMs: 0 }]
  s.round.spoken = { name: 'Ada', transcript: 'marie curie', hit: true }
  s.round.award = { name: 'Ada', points: 300 }
  s.round.answer = 'Marie Curie'
  s.round.phase = 'IDLE'
  s.round.order = []
  const paid = at()
  assert.equal(paid.moment, 'verdict:award')
  assert.equal(paid.award?.answer, 'Marie Curie')
  assert.deepEqual(paid.hero, { name: 'Ada', tone: 'awarded' }, 'the winner holds the stage')
  assert.equal(paid.clue, null, 'the question behind a correct answer is spent')
})

test('a duel: nominations, the seat, and both missing', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [{ playerId: 'a', votes: ['b'], in: true }], missed: [] }
  assert.equal(momentOf(s, LOCAL), 'duel:nominating')
  oneOf(wallOf(s, LOCAL), 'nominating')
  assert.equal(wallOf(s, LOCAL).nominations, 'solo')

  s.grouping = 'teams'
  assert.equal(wallOf(s, LOCAL).nominations, 'teams')

  s.duel.seated = ['a', 'b']
  assert.equal(momentOf(s, LOCAL), 'duel:faceoff')
  assert.deepEqual(wallOf(s, LOCAL).faceoff, ['Ada', 'Bo'])

  s.round.buzzable = []
  assert.equal(momentOf(s, LOCAL), 'duel:dead')
  assert.equal(wallOf(s, LOCAL).call, 'dead')
})

test('a duel rebound keeps the miss up until the other one buzzes', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  s.round.buzzable = ['a', 'b']

  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  s.round.buzzable = ['b']
  s.round.lockedOut = ['a']
  s.round.award = { name: 'Ada', points: -100 }

  const dwelt: Local = { ...LOCAL, open: true, retired: true }
  assert.equal(momentOf(s, dwelt), 'verdict:penalty')
  const w = wallOf(s, dwelt)
  oneOf(w, 'a held rebound')
  assert.equal(w.hero?.tone, 'penalised')
  assert.equal(w.award?.points, -100)

  s.round.phase = 'COLLECTING'
  assert.notEqual(momentOf(s, dwelt), 'verdict:penalty')
  oneOf(wallOf(s, dwelt), 'the rebound answered')
})

test('a face-off survives its own rebound narrowing buzzable to one', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  s.round.phase = 'ARMED'
  s.round.buzzable = ['b']
  s.round.lockedOut = ['a']

  const w = wallOf(s, { ...LOCAL, open: true, retired: true })
  oneOf(w, 'a penalty-free rebound')
  assert.deepEqual(w.faceoff, ['Ada', 'Bo'])
  assert.equal(w.call, null)
})

test('a wrong that cost nothing is still a miss, not a payoff of zero', () => {
  const s = room()
  s.round.phase = 'ARMED'
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  assert.equal(momentOf(s, LOCAL), 'verdict:penalty')
  const w = wallOf(s, LOCAL)
  assert.equal(w.hero?.tone, 'penalised')
  assert.equal(w.award?.points, 0)

  s.round.award = { name: 'Ada', points: 0 }
  assert.equal(momentOf(s, LOCAL), 'verdict:award')
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'awarded' })
})

test('idle:welcome ends at the first arm, not at the first buzz', () => {
  const s = room()
  assert.equal(momentOf(s, LOCAL), 'idle:welcome')
  s.round.armedAt = 1000
  s.round.phase = 'IDLE'
  assert.equal(momentOf(s, LOCAL), 'idle:ready')

  const t = room()
  t.scores.a = 200
  assert.equal(momentOf(t, LOCAL), 'idle:ready')
})

test('the phone: a question from second place, and the rebound', () => {
  const mine = {
    frozen: false, barred: false, spectator: false, dead: false,
    won: false, pressed: false, armed: false, open: false, judging: false,
  }
  assert.equal(phoneOf('idle:ready', mine).label, 'Wait')
  assert.equal(phoneOf('buzz:arming', { ...mine, armed: true }).sub, 'Any moment')
  assert.equal(phoneOf('buzz:open', { ...mine, armed: true, open: true }).label, 'Buzz')
  assert.equal(phoneOf('buzz:collecting', { ...mine, armed: true, pressed: true }).label, 'In')

  assert.equal(phoneOf('answer:locked', { ...mine, won: true }).label, 'You’re up')
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, judging: true }).talk, true)
  {
    const barredPhone = phoneOf('answer:locked', {
      ...mine,
      won: true,
      judging: true,
      frozen: true,
    })
    assert.equal(barredPhone.talk, false)
    assert.equal(barredPhone.mood, 'barred')
  }
  assert.equal(phoneOf('answer:locked', { ...mine, deltaMs: 140 }).sub, '+140 ms')
  assert.equal(phoneOf('verdict:hold', mine).sub, 'Reopening in a moment')
  assert.equal(phoneOf('answer:locked', mine).sub, 'Someone else is answering')
  assert.equal(phoneOf('answer:judging', mine).sub, 'Someone else is answering')
  assert.equal(phoneOf('answer:locked', { ...mine, deltaMs: 0 }).sub, '+0 ms')

  assert.equal(phoneOf('answer:judging', { ...mine, armed: true, open: true }).label, 'Buzz')

  assert.equal(phoneOf('duel:dead', { ...mine, dead: true }).label, 'Duel')
  assert.equal(
    phoneOf('verdict:hold', { ...mine, dead: true }).sub,
    'Both missed — waiting for the host',
    'not "reopening in a moment" — nothing is going to reopen',
  )
  assert.equal(
    phoneOf('buzz:open', { ...mine, spectator: true, buzzableNames: ['Ada', 'Bo'] }).sub,
    'Ada vs Bo — you sit this one out',
  )
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, frozen: true }).label, 'Frozen')
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, barred: true }).label, 'Out')
})

test('a correct answerer sees the actual award before the next question', () => {
  const mine = {
    frozen: false, barred: false, spectator: false, dead: false,
    won: true, pressed: true, armed: false, open: false, judging: false,
    value: 400, awardPoints: 450,
  }
  const right = phoneOf('verdict:award', mine)
  assert.deepEqual([right.label, right.sub, right.mood], ['Right', '+450', 'first'])
  assert.equal(phoneOf('idle:ready', mine).label, 'Right')
  assert.equal(phoneOf('verdict:award', { ...mine, won: false }).label, 'Wait')
  assert.equal(phoneOf('idle:ready', { ...mine, told: { name: 'Ada', points: 450 } }).label, 'Right')
})

test('every other phone feels the verdict, and only while it stands', () => {
  const mine = {
    frozen: false, barred: false, spectator: false, dead: false,
    won: false, pressed: false, armed: false, open: false, judging: false, next: 400,
  }
  const paid = { name: 'Ada', points: 400 }
  const right = phoneOf('idle:ready', { ...mine, told: paid })
  assert.deepEqual(right, { label: 'Ada', sub: '+400 · right', mood: 'verdict', talk: false, tone: 'awarded', react: false })
  assert.equal(phoneOf('idle:ready', mine).sub, 'Next question · 400 points')
  assert.equal(phoneOf('idle:ready', { ...mine, spectator: true, buzzableNames: ['Ada', 'Bo'], told: paid }).label, 'Ada')
  assert.equal(phoneOf('idle:ready', { ...mine, frozen: true, told: paid }).label, 'Ada')
  assert.equal(phoneOf('idle:finale', { ...mine, place: 2, told: paid }).label, 'Final')
  assert.equal(phoneOf('buzz:arming', { ...mine, armed: true, told: paid }).sub, 'Any moment')

  const miss = { name: 'Ada', points: -200, penalty: true as const }
  const wrong = phoneOf('verdict:hold', { ...mine, told: miss })
  assert.deepEqual(wrong, { label: 'Ada', sub: '−200 · wrong, rebound opening', mood: 'verdict', talk: false, tone: 'penalised', react: false })
  assert.equal(phoneOf('buzz:arming', { ...mine, armed: true, told: miss }).sub, 'Any moment')
  assert.equal(phoneOf('verdict:penalty', { ...mine, armed: true, told: miss }).sub, 'Any moment')
  assert.equal(phoneOf('verdict:penalty', { ...mine, armed: true, open: true, told: miss }).label, 'Buzz')
  assert.equal(phoneOf('answer:locked', { ...mine, told: miss }).label, 'Locked')
  assert.equal(phoneOf('idle:ready', { ...mine, told: miss }).label, 'Wait')
  assert.equal(phoneOf('verdict:hold', { ...mine, barred: true, told: miss }).label, 'Out')
  assert.equal(phoneOf('verdict:hold', { ...mine, spectator: true, buzzableNames: ['Bo'], told: miss }).label, 'Duel')
  assert.equal(phoneOf('verdict:hold', { ...mine, frozen: true, told: miss }).label, 'Frozen')

  assert.equal(phoneOf('verdict:hold', { ...mine, told: { name: 'Ada', points: 0, penalty: true } }).sub, 'wrong, rebound opening')
  assert.equal(phoneOf('idle:ready', { ...mine, told: { name: 'Ada', points: 0 } }).sub, 'right')
})

test('a penalty comes down when someone takes the question over', () => {
  const s = room()
  s.round.phase = 'ARMED'
  s.round.armedAt = 5000
  s.round.award = { name: 'Bo', points: -300 }
  const rebound = wallOf(s, { open: true, settled: true, retired: false })
  assert.equal(rebound.moment, 'verdict:penalty')
  assert.equal(rebound.award?.points, -300, 'up while nobody has taken it')

  s.round.phase = 'LOCKED'
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 5200, deltaMs: 0 }]
  const taken = wallOf(s, { open: true, settled: true, retired: false })
  assert.equal(taken.moment, 'answer:locked')
  assert.deepEqual(taken.hero, { name: 'Ada', tone: 'answering' })
  assert.equal(taken.award, null, 'and gone the moment Ada is up')
  oneOf(taken, 'the handover')
})

test('a rebound taken inside the penalty dwell shows the new leader, not the miss', () => {
  const s = room()
  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  s.round.lockedOut = ['a']
  s.round.award = { name: 'Ada', points: -100, penalty: true }
  const dwelling: Local = { ...LOCAL, open: true, retired: false }
  assert.equal(momentOf(s, dwelling), 'verdict:penalty')

  s.round.phase = 'COLLECTING'
  s.round.order = [{ playerId: 'b', name: 'Bo', at: 1400, deltaMs: 400 }]
  assert.equal(momentOf(s, dwelling), 'buzz:collecting')
  const w = wallOf(s, dwelling)
  oneOf(w, 'a rebound taken inside the dwell')
  assert.deepEqual(w.hero, { name: 'Bo', tone: 'answering' })
  assert.equal(w.award, null, 'the last miss is not still stamped over the new name')
})

test('a duel buzz takes the stage from the pair on the same frame as the cue', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  s.round.buzzable = ['a', 'b']
  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  const live: Local = { ...LOCAL, open: true }
  assert.deepEqual(wallOf(s, live).faceoff, ['Ada', 'Bo'])

  s.round.phase = 'COLLECTING'
  assert.equal(momentOf(s, live), 'buzz:collecting')
  assert.deepEqual(wallOf(s, live).faceoff, ['Ada', 'Bo'], 'still the pair, briefly')

  s.round.order = [{ playerId: 'a', name: 'Ada', at: 1200, deltaMs: 0 }]
  const w = wallOf(s, live)
  oneOf(w, 'a duel buzz')
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'answering' })
  assert.equal(w.faceoff, null)
})

test('a payoff keeps the winner on the stage, in a duel and out of one', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  s.round.buzzable = ['a', 'b']
  s.round.phase = 'IDLE'
  s.round.armedAt = 1000
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 1200, deltaMs: 0 }]
  s.round.award = { name: 'Ada', points: 200 }

  const w = wallOf(s, LOCAL)
  assert.equal(momentOf(s, LOCAL), 'verdict:award')
  oneOf(w, 'a duel payoff')
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'awarded' }, 'not back to the pair')
  assert.equal(w.faceoff, null)
  assert.equal(w.award?.points, 200)

  delete s.duel
  delete s.round.buzzable
  const solo = wallOf(s, LOCAL)
  oneOf(solo, 'a solo payoff')
  assert.deepEqual(solo.hero, { name: 'Ada', tone: 'awarded' })

  s.round.fragments = ['A clue.']
  assert.equal(wallOf(s, LOCAL).clue, null)
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'awarded' })
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  assert.equal(wallOf(s, LOCAL).hero?.tone, 'penalised', 'a miss keeps it too, and says why')
})

test('the box picking the question back up ends the penalty, dwell or no dwell', () => {
  const s = room()
  s.autoplay = { on: true, nextSec: 4, buzzSec: 4, reboundSec: 3, introSec: 12 }
  s.readingActive = true
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 4,
    paused: false,
  }
  s.round = {
    ...s.round,
    phase: 'LOCKED',
    armedAt: 4000,
    held: true,
    award: { name: 'Bo', points: -100, penalty: true },
    whole: 'One. Two. Three.',
    fragments: ['One.'],
  }

  const held = wallOf(s, LOCAL)
  oneOf(held, 'held')
  assert.equal(held.moment, 'verdict:hold')
  assert.deepEqual(held.hero, { name: 'Bo', tone: 'penalised' })

  delete s.round.held
  s.round.phase = 'ARMED'
  s.round.armedAt = 7000
  const back = wallOf(s, { ...LOCAL, open: true, retired: false })
  oneOf(back, 'handed back')
  assert.equal(back.moment, 'buzz:open', 'the stamp does not outlive the voice')
  assert.equal(back.award, null)
  assert.deepEqual(back.clue, { whole: 'One. Two. Three.', shown: 'One.' })
})

test('a payoff keeps the stage while the box has a clue up', () => {
  const s = room()
  s.readingActive = true
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 3, fragTotal: 4,
    paused: false,
  }
  s.round = {
    ...s.round,
    phase: 'IDLE',
    armedAt: 4000,
    award: { name: 'Ada', points: 200 },
    answer: 'Marie Curie',
    whole: 'One. Two. Three.',
    fragments: ['One.', 'Two.', 'Three.'],
  }

  const paid = wallOf(s, LOCAL)
  oneOf(paid, 'paid')
  assert.equal(paid.moment, 'verdict:award')
  assert.deepEqual(paid.hero, { name: 'Ada', tone: 'awarded' }, 'the winner, not the spent question')
  assert.equal(paid.clue, null)
  assert.equal(paid.award?.answer, 'Marie Curie')
})

test('a spent setlist is the finale, with every tied leader named', () => {
  const s = room()
  s.scores = { a: 400, b: 400 }
  s.setlist = { blocks: [{ game: 'trivia', options: {}, count: 1 }], at: 1, done: 0 }
  const w = wallOf(s, LOCAL)
  oneOf(w, 'finale')
  assert.equal(w.moment, 'idle:finale')
  assert.deepEqual(w.finale, [{ place: 1, names: ['Ada', 'Bo'], score: 400 }])
})

test('the podium: distinct places 1 to 3, a tie for 2nd leaves no 3rd, one and two players, teams', () => {
  const s = room()
  s.players.push({ id: 'c', name: 'Cy', connected: true }, { id: 'd', name: 'Dee', connected: true })
  s.scores = { a: 400, b: 200, c: 200, d: 100 }
  assert.deepEqual(finaleTiers(s), [
    { place: 1, names: ['Ada'], score: 400 },
    { place: 2, names: ['Bo', 'Cy'], score: 200 },
  ])
  s.scores = { a: 400, b: 300, c: 200, d: 100 }
  assert.deepEqual(finaleTiers(s).map((t) => [t.place, t.names]), [[1, ['Ada']], [2, ['Bo']], [3, ['Cy']]])
  s.scores = { a: 0, b: 0, c: 0, d: 0 }
  assert.deepEqual(finaleTiers(s), [{ place: 1, names: ['Ada', 'Bo', 'Cy', 'Dee'], score: 0 }])
  const two = room()
  two.scores = { a: 100, b: 50 }
  assert.deepEqual(finaleTiers(two).map((t) => t.place), [1, 2])
  const one = room()
  one.players = [one.players[0]]
  one.scores = { a: 0 }
  assert.deepEqual(finaleTiers(one), [{ place: 1, names: ['Ada'], score: 0 }])
  const teams = room()
  teams.grouping = 'teams'
  teams.teams = [{ id: 't1', name: 'Reds', color: '#f00' }, { id: 't2', name: 'Blues', color: '#00f' }]
  teams.scores = { t1: 100, t2: 300, a: 900 }
  assert.deepEqual(finaleTiers(teams).map((t) => [t.place, t.names]), [[1, ['Blues']], [2, ['Reds']]], 'by team, not by member')
  const empty = room()
  empty.players = []
  empty.scores = {}
  assert.deepEqual(finaleTiers(empty), [])
})

test('finaleStep walks build, 3rd, 2nd, 1st at the schedule, skipping places the podium lacks', () => {
  const { build, third, second } = FINALE_SCHEDULE
  const three = [{ place: 1 }, { place: 2 }, { place: 3 }] as const
  assert.deepEqual(finaleStep(three, 0), { step: 'build', until: build })
  assert.deepEqual(finaleStep(three, build - 1), { step: 'build', until: build })
  assert.deepEqual(finaleStep(three, build), { step: 3, until: build + third })
  assert.deepEqual(finaleStep(three, build + third - 1).step, 3)
  assert.deepEqual(finaleStep(three, build + third), { step: 2, until: build + third + second })
  assert.deepEqual(finaleStep(three, build + third + second), { step: 1, until: Infinity })
  const tied = [{ place: 1 }, { place: 2 }]
  assert.deepEqual(finaleStep(tied, build), { step: 2, until: build + second })
  assert.equal(finaleStep(tied, build + second).step, 1)
  assert.deepEqual(finaleStep([{ place: 1 }], build), { step: 1, until: Infinity })
  assert.equal(finaleStep(three, Infinity).step, 1)
})

test('a milestone shows for its question, not the next one, and not at the finale', () => {
  const s = room()
  s.round.questionId = 'q1'
  s.scores = { a: 200, b: 0 }
  s.night = {
    facts: [
      { kind: 'standings', at: 1, order: [{ key: 'a', score: 0 }, { key: 'b', score: 0 }] },
      { kind: 'standings', at: 2, questionId: 'q1', order: [{ key: 'b', score: 0 }, { key: 'a', score: 0 }] },
      { kind: 'standings', at: 3, questionId: 'q1', order: [{ key: 'a', score: 200 }, { key: 'b', score: 0 }] },
    ],
  }
  assert.equal(wallOf(s, LOCAL).milestone, 'New leader: Ada')
  s.round.questionId = 'q2'
  assert.equal(wallOf(s, LOCAL).milestone, null)
  s.round.questionId = ''
  s.setlist = { blocks: [{ game: 'trivia', options: {}, count: 1 }], at: 1, done: 0 }
  assert.equal(wallOf(s, LOCAL).moment, 'idle:finale')
  assert.equal(wallOf(s, LOCAL).milestone, null)
})

test('a state without a night has no milestone', () => {
  const s = room()
  s.round.questionId = 'q1'
  assert.equal(s.night, undefined)
  assert.equal(wallOf(s, LOCAL).milestone, null)
})

test('a payoff on the last question outranks the finale', () => {
  const s = room()
  s.scores = { a: 400, b: 0 }
  s.setlist = { blocks: [{ game: 'trivia', options: {}, count: 1 }], at: 1, done: 0 }
  s.round.award = { name: 'Ada', points: 400 }
  s.round.armedAt = 1
  assert.equal(momentOf(s, LOCAL), 'verdict:award')
})

test('the finale tells each phone where it finished, once the wall has called its place', () => {
  const mine = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: false, open: false, judging: false, called: true }
  assert.equal(phoneOf('idle:finale', { ...mine, place: 1 }).label, 'Winner')
  const second = phoneOf('idle:finale', { ...mine, place: 2 })
  assert.equal(second.label, 'Final')
  assert.equal(second.sub, '2nd place')
  assert.equal(phoneOf('idle:finale', { ...mine, place: 11 }).sub, '11th place')
  const held = phoneOf('idle:finale', { ...mine, place: 1, called: false })
  assert.deepEqual([held.label, held.sub, held.mood], ['Final', 'Watch the board', 'waiting'], 'no place before its turn, not even the winner')
})

test('finaleCalled: each podium place at its own step, everyone else with the winner', () => {
  assert.equal(finaleCalled('build', 1), false)
  assert.deepEqual([3, 2, 1].map((s) => finaleCalled(s as 3 | 2 | 1, 3)), [true, true, true])
  assert.deepEqual([3, 2, 1].map((s) => finaleCalled(s as 3 | 2 | 1, 2)), [false, true, true])
  assert.deepEqual([3, 2, 1].map((s) => finaleCalled(s as 3 | 2 | 1, 1)), [false, false, true])
  assert.deepEqual([3, 2, 1].map((s) => finaleCalled(s as 3 | 2 | 1, 4)), [false, false, true])
  assert.equal(finaleCalled(finaleStep([{ place: 1 }, { place: 2 }], FINALE_SCHEDULE.build).step, 2), true)
})

test('the stakes chip stays up while an answer is typed and judged', () => {
  const s = room()
  s.readingActive = true
  s.round.armedAt = 1
  s.round.spoken = { name: 'Ada', transcript: 'the Atlantic', hit: false }
  assert.equal(wallOf(s, { ...LOCAL, settled: false }).moment, 'answer:judging')
  assert.equal(wallOf(s, { ...LOCAL, settled: false }).value, 200)
  s.round.held = true
  s.round.award = { name: 'Ada', points: -100, penalty: true }
  assert.equal(wallOf(s, LOCAL).value, 200)
})

test('between questions the stage names the next one and what it is worth', () => {
  const s = room()
  assert.equal(wallOf(s, LOCAL).moment, 'idle:welcome')
  assert.equal(wallOf(s, LOCAL).next, null)
  assert.equal(wallOf(s, LOCAL).call, 'ready')
  s.scores = { a: 200, b: 0 }
  const ready = wallOf(s, LOCAL)
  oneOf(ready, 'ready')
  assert.equal(ready.moment, 'idle:ready')
  assert.equal(ready.next, 200)
  assert.equal(ready.value, null, 'the card says it; no chip as well')
  s.setlist = { blocks: [{ game: 'trivia', options: {}, count: 1 }], at: 1, done: 0 }
  assert.equal(wallOf(s, LOCAL).next, null)
})

test('a waiting phone reads the next question and its value', () => {
  const mine = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: false, open: false, judging: false }
  assert.equal(phoneOf('idle:ready', { ...mine, next: 300 }).sub, 'Next question · 300 points')
  assert.equal(phoneOf('idle:welcome', { ...mine, next: 300 }).sub, 'The host has not armed yet')
})

test('the next-question card holds the stage while the reader waits to arm', () => {
  const s = room()
  s.scores = { a: 200, b: 0 }
  s.readingActive = true
  const w = wallOf(s, LOCAL)
  oneOf(w, 'reader between questions')
  assert.equal(w.next, 200)
})

test('the last question is the final block on its final count', () => {
  const s = room()
  assert.ok(!lastUp(s), 'no setlist, no last question')
  const block = { game: 'trivia', options: {}, count: 2 }
  s.setlist = { blocks: [block, block], at: 0, done: 1 }
  assert.ok(!lastUp(s), 'the last of an earlier block')
  s.setlist = { blocks: [block, block], at: 1, done: 0 }
  assert.ok(!lastUp(s))
  s.setlist.done = 1
  assert.ok(lastUp(s))
  s.setlist = { blocks: [block, block], at: 2, done: 0 }
  assert.ok(!lastUp(s), 'a spent setlist has none left')
})

function choiceRoom(): State {
  const s = room()
  s.round = {
    ...s.round, questionId: 'q', attemptId: 'a1', phase: 'ARMED', armedAt: 1, kind: 'choice',
    fragments: ['Which planet has the most moons?'], whole: 'Which planet has the most moons?',
  }
  s.readingActive = true
  return s
}

test('a choice question: listening, picking, reveal, with the clue in the middle throughout', () => {
  const s = choiceRoom()
  assert.equal(momentOf(s, LOCAL), 'choice:listening')
  let w = wallOf(s, LOCAL)
  assert.equal(w.choices, null)
  assert.equal(w.clue?.shown, 'Which planet has the most moons?')
  assert.equal(w.hero, null)

  s.round.choices = ['Mars', 'Saturn']
  s.round.picks = { b: 1 }
  assert.equal(momentOf(s, LOCAL), 'choice:picking')
  w = wallOf(s, LOCAL)
  assert.deepEqual(w.choices, {
    options: ['Mars', 'Saturn'], points: 200, closesAt: undefined,
    pickers: [{ id: 'b', picked: true }, { id: 'a', picked: false }],
  })
  assert.ok(w.clue)

  s.round.picks = { a: 1, b: 0 }
  s.round.correct = 1
  s.round.phase = 'IDLE'
  assert.equal(momentOf(s, LOCAL), 'choice:reveal')
  w = wallOf(s, LOCAL)
  assert.deepEqual(w.choices?.by, [['b'], ['a']])
  assert.deepEqual(w.choices?.winners, ['Ada'])
  assert.equal(w.award, null)
  assert.equal(w.hero, null)
  assert.ok(w.clue)
  assert.equal(w.value, 200)
})

test('the phone during a choice question', () => {
  const base = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: true, open: true, judging: false }
  assert.equal(phoneOf('choice:listening', base).label, 'Listen')
  assert.equal(phoneOf('choice:picking', base).label, 'Pick')
  assert.equal(phoneOf('choice:picking', { ...base, pick: 1, choices: ['Mars', 'Saturn'] }).sub, 'Saturn')
  const right = phoneOf('choice:reveal', { ...base, armed: false, pick: 1, correct: 1, choices: ['Mars', 'Saturn'], value: 200 })
  assert.deepEqual([right.label, right.sub, right.mood], ['Right', '+200', 'first'])
  const wrong = phoneOf('choice:reveal', { ...base, armed: false, pick: 0, correct: 1, choices: ['Mars', 'Saturn'], value: 200 })
  assert.deepEqual([wrong.label, wrong.sub], ['Wrong', 'It was Saturn'])
  assert.equal(phoneOf('choice:reveal', { ...base, armed: false, correct: 1, choices: ['Mars', 'Saturn'] }).label, 'No pick')
})

test('a closest question: listening, guessing with no numbers up, then the line at the reveal', () => {
  const s = room()
  s.players.push({ id: 'c', name: 'Cy', connected: true })
  s.round = {
    ...s.round, questionId: 'q', attemptId: 'a1', phase: 'ARMED', armedAt: 1, kind: 'closest',
    fragments: ['How many steps?'], whole: 'How many steps?',
  }
  s.readingActive = true
  assert.equal(momentOf(s, LOCAL), 'closest:listening')
  assert.equal(wallOf(s, LOCAL).closest, null)

  s.round.guessing = { unit: 'steps', closesAt: 99 }
  s.round.guesses = { b: 1200 }
  assert.equal(momentOf(s, LOCAL), 'closest:guessing')
  let w = wallOf(s, LOCAL)
  assert.deepEqual(w.closest, {
    unit: 'steps', points: 200, closesAt: 99,
    guessers: [{ id: 'b', guessed: true }, { id: 'a', guessed: false }, { id: 'c', guessed: false }],
  })
  assert.equal(JSON.stringify(w.closest).includes('1200'), false, 'no number on the wall while the room guesses')
  assert.ok(w.clue)
  assert.equal(w.hero, null)

  s.round.guesses = { b: 1200, a: 1700, c: 1500 }
  s.round.truth = 1665
  s.round.paid = { a: 200 }
  s.round.phase = 'IDLE'
  assert.equal(momentOf(s, LOCAL), 'closest:reveal')
  w = wallOf(s, LOCAL)
  const c = w.closest!
  assert.equal(c.truth?.text, '1,665')
  assert.deepEqual(c.marks?.map((m) => [m.name, m.text, m.paid, m.place]), [
    ['Bo', '1,200', 0, undefined], ['Cy', '1,500', 0, undefined], ['Ada', '1,700', 200, 1],
  ])
  const at = c.marks!.map((m) => m.at)
  assert.ok(at[0] < at[1] && at[1] < c.truth!.at && c.truth!.at < at[2], 'low to high along the line')
  assert.deepEqual(c.winners, [{ name: 'Ada', paid: 200, off: 35 }])
  assert.equal(w.award, null)
  assert.equal(w.value, 200)
})

test('a closest reveal ranks by distance, not by points', () => {
  const s = room()
  s.round = { ...s.round, questionId: 'q', attemptId: 'a1', phase: 'IDLE', kind: 'closest', guessing: { closesAt: 1 }, truth: 10 }
  s.round.guesses = { a: 11, b: 9, c: 11, d: 13 }
  s.round.paid = { a: 67, b: 67, c: 67, d: 100 }
  const marks = wallOf(s, LOCAL).closest!.marks!
  assert.deepEqual(Object.fromEntries(marks.map((m) => [m.id, m.place])), { a: 1, b: 1, c: 1, d: 2 })
})

test('the phone during a closest question', () => {
  const base = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: true, open: true, judging: false }
  assert.equal(phoneOf('closest:listening', base).label, 'Listen')
  assert.equal(phoneOf('closest:guessing', base).label, 'Guess')
  assert.equal(phoneOf('closest:guessing', { ...base, closed: true }).label, 'Time’s up')
  assert.equal(phoneOf('closest:guessing', { ...base, guess: 1700, unit: 'steps' }).sub, '1,700 steps')
  const done = { ...base, armed: false, unit: 'steps', truth: 1665, nearest: 35 }
  const won = phoneOf('closest:reveal', { ...done, guess: 1700, paid: 200 })
  assert.deepEqual([won.label, won.sub, won.mood], ['Nearest', '+200 · 35 off', 'first'])
  const second = phoneOf('closest:reveal', { ...done, guess: 1500, paid: 100 })
  assert.deepEqual([second.label, second.sub, second.mood], ['Second', '+100 · 165 off', 'placed'])
  assert.equal(phoneOf('closest:reveal', { ...done, unit: undefined, plain: true, truth: 1989, guess: 1980 }).sub, 'It was 1989')
  assert.equal(phoneOf('closest:reveal', { ...done, nearest: 0, guess: 1665, paid: 400 }).label, 'Exact')
  const lost = phoneOf('closest:reveal', { ...done, guess: 1200 })
  assert.deepEqual([lost.label, lost.sub, lost.mood], ['465 off', 'It was 1,665 steps', 'barred'])
  assert.equal(phoneOf('closest:reveal', done).label, 'No guess')
})

test('a scoreless mode starts blank, never calls Buzz, and holds a miss until the next buzz', () => {
  const s = room()
  s.games = [{ id: 'buzzer', name: 'Pure buzzer', options: [], scoreless: true }]
  s.game.id = 'buzzer'
  const open: Local = { open: true, settled: true, retired: true }
  const blank = (w: Wall) =>
    [w.hero, w.clue, w.call, w.next, w.award, w.value].every((x) => x === null)
  assert.ok(blank(wallOf(s, open)), 'idle')
  s.round = { ...s.round, questionId: 'q', attemptId: 'x', phase: 'ARMED', armedAt: 1 }
  assert.ok(blank(wallOf(s, open)), 'armed')
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  const w = wallOf(s, open)
  assert.equal(w.moment, 'verdict:penalty')
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'penalised' })
  assert.equal(w.award?.scoreless, true, 'stamped as a verdict, not a 0')
  s.round.phase = 'COLLECTING'
  s.round.order = [{ playerId: 'b', name: 'Bo', at: 2, deltaMs: 0 }]
  assert.deepEqual(wallOf(s, open).hero, { name: 'Bo', tone: 'answering' })
})

test('the hero is tungsten-open while answering and brass only once awarded', () => {
  const s = room()
  s.round = { ...s.round, questionId: 'q', attemptId: 'x', phase: 'LOCKED', armedAt: 1 }
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 5200, deltaMs: 0 }]
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'answering' }, 'a buzz, judge open')

  s.round.award = { name: 'Ada', points: 300 }
  s.round.phase = 'IDLE'
  s.round.order = []
  const w = wallOf(s, LOCAL)
  assert.equal(w.moment, 'verdict:award')
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'awarded' }, 'same name, new tone')
})

test('the reaction row shows while locked out behind the leader or with a verdict up, never for the answerer or under an arrival', () => {
  const mine = {
    frozen: false, barred: false, spectator: false, dead: false,
    won: false, pressed: false, armed: false, open: false, judging: false,
  }
  assert.equal(phoneOf('idle:ready', mine).react, false)
  assert.equal(phoneOf('buzz:open', { ...mine, armed: true, open: true }).react, false)
  assert.equal(phoneOf('answer:locked', { ...mine, locked: true }).react, true)
  assert.equal(phoneOf('answer:locked', { ...mine, locked: true, won: true }).react, false, 'the answerer has no row')
  assert.equal(phoneOf('verdict:hold', { ...mine, locked: true, scored: true }).react, true)
  assert.equal(phoneOf('idle:ready', { ...mine, won: true, scored: true, awardPoints: 400 }).react, true)
  assert.equal(phoneOf('verdict:award', { ...mine, scored: true, told: { name: 'Ada', points: 400 } }).mood, 'verdict', 'the flag composes with the verdict mood')
  assert.equal(phoneOf('verdict:award', { ...mine, scored: true, told: { name: 'Ada', points: 400 } }).react, true)
  assert.equal(phoneOf('arrival:lobby', { ...mine, locked: true, scored: true }).react, false)
})
