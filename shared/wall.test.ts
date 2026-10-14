import test from 'node:test'
import assert from 'node:assert/strict'
import { lastUp, momentOf, phoneOf, wallOf, type Local, type Wall } from './wall.ts'
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
    autoplay: { on: false, nextSec: 4, buzzSec: 4, reboundSec: 3, introSec: 12 },
  }
}

/**
 * The invariant, mechanically. Those five are the middle band's occupants, and
 * "the clue came back under the transcript" is precisely two of them at once.
 */
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

  // Armed, then open. The lead is a real state: live, but nobody may press.
  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  assert.equal(at().moment, 'buzz:arming')
  assert.equal(at().next, 200, 'the card holds through the lead')
  assert.equal(at().value, null, 'without the chip repeating it')
  assert.equal(at({ open: true }).moment, 'buzz:open')
  assert.equal(at({ open: true }).call, 'buzz')

  // First press. Before the hub's 150ms reveal the order is empty and the wall
  // is unchanged — the room learns nothing the hub has not published.
  s.round.phase = 'COLLECTING'
  assert.equal(at({ open: true }).moment, 'buzz:collecting')
  assert.equal(at({ open: true }).hero, null, 'no leader before the reveal')
  s.round.order = [{ playerId: 'b', name: 'Bo', at: 1100, deltaMs: 0 }]
  s.round.total = 1
  assert.deepEqual(at().hero, { name: 'Bo', tone: 'answering' })

  s.round.phase = 'LOCKED'
  assert.equal(at().moment, 'answer:locked')

  // The judge publishes the transcript, the award and `held` in one broadcast.
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

  // The rebound opens. The clue resumes on a clean wall: the server drops the
  // transcript with the hold, which is what `rebound` in state.ts does.
  delete s.round.held
  delete s.round.spoken
  s.round.phase = 'ARMED'
  s.round.armedAt = 5000
  // With no box, the miss holds through the lead.
  assert.deepEqual(at({ retired: true }).hero, { name: 'Bo', tone: 'penalised' })
  s.readingActive = true
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 4,
    paused: false,
  }
  s.round.whole = 'One. Two. Three.'
  s.round.fragments = ['One.']
  // The hold was the room's look at the miss, and the box opening the rebound
  // is the beat ending: the voice picks the question back up in that instant,
  // so the stage goes with it. The board's own dwell has no say while the box
  // is driving — it is measured from a different moment and cannot agree.
  const on = at({ open: true, retired: false })
  assert.equal(on.moment, 'buzz:open')
  assert.equal(on.award, null, 'the stamp does not outlive the voice')
  assert.deepEqual(on.clue, { whole: 'One. Two. Three.', shown: 'One.' })
  assert.equal(on.value, 200, 'what is at stake comes back with it')

  // Someone else takes it.
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

  // `[]`, not absent. The fall-through would otherwise invite the whole room to
  // buzz on a question nobody may answer.
  s.round.buzzable = []
  assert.equal(momentOf(s, LOCAL), 'duel:dead')
  assert.equal(wallOf(s, LOCAL).call, 'dead')
})

test('a duel rebound keeps the miss up until the other one buzzes', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  s.round.buzzable = ['a', 'b']

  // Ada misses. The rebound is open, to Bo alone.
  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  s.round.buzzable = ['b']
  s.round.lockedOut = ['a']
  s.round.award = { name: 'Ada', points: -100 }

  const dwelt: Local = { ...LOCAL, open: true, retired: true }
  // The dwell has elapsed and outside a duel that would retire the stamp. Here
  // it must not: the question is still live and nobody has answered it yet.
  assert.equal(momentOf(s, dwelt), 'verdict:penalty')
  const w = wallOf(s, dwelt)
  oneOf(w, 'a held rebound')
  assert.equal(w.hero?.tone, 'penalised')
  assert.equal(w.award?.points, -100)

  // Bo buzzes. That, not a timer, is what takes it down.
  s.round.phase = 'COLLECTING'
  assert.notEqual(momentOf(s, dwelt), 'verdict:penalty')
  oneOf(wallOf(s, dwelt), 'the rebound answered')
})

test('a face-off survives its own rebound narrowing buzzable to one', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [], seated: ['a', 'b'], missed: [] }
  // No award at all — an undo, or a module that stamps none. The wall has only
  // the duel to go on, and it must still be the duel, not a bare "Ready".
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
  // `points` is what a surface actually receives: the server writes `-0` and
  // JSON flattens it to `0` on the way out, which is exactly why the sign
  // cannot carry this and the flag has to. Without it the room is shown a
  // reward for missing.
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  assert.equal(momentOf(s, LOCAL), 'verdict:penalty')
  const w = wallOf(s, LOCAL)
  assert.equal(w.hero?.tone, 'penalised')
  assert.equal(w.award?.points, 0)

  // And a real payoff of zero — a question worth nothing — still reads as one.
  s.round.award = { name: 'Ada', points: 0 }
  assert.equal(momentOf(s, LOCAL), 'verdict:award')
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'awarded' })
})

test('idle:welcome ends at the first arm, not at the first buzz', () => {
  // Keyed on armedAt because the buzz count is redacted — a non-buzzing phone
  // would otherwise still be at welcome while the wall had moved on.
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
  // The mic mounts off this same ladder rather than a second expression on
  // the phone: locked in as leader, with the judge's window open, is `talk`.
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, judging: true }).talk, true)
  // Frozen outranks it: a frozen leader with the judge's window open gets no
  // mic, which only holds while `talk` rides the ladder rather than its own
  // predicate.
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
  // Locked with no margin says why: a leader holds the question. A dead heat
  // is still a placing, not an absence.
  assert.equal(phoneOf('answer:locked', mine).sub, 'Someone else is answering')
  assert.equal(phoneOf('answer:judging', mine).sub, 'Someone else is answering')
  assert.equal(phoneOf('answer:locked', { ...mine, deltaMs: 0 }).sub, '+0 ms')

  // A transcript typing over an *open* rebound is not "somebody is answering":
  // the question is live again and this phone may press.
  assert.equal(phoneOf('answer:judging', { ...mine, armed: true, open: true }).label, 'Buzz')

  // `dead` is the phone's own, not the moment: a dead duel outranks the answer
  // states here, where on the wall a miss still being read outranks it.
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
  // Frozen and barred outrank everything, including being the one answering.
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
})

test('a penalty comes down when someone takes the question over', () => {
  // `wrong` re-stamps the award negative and leaves it standing through the
  // rebound (server/state.ts), so an award can genuinely be up at LOCKED.
  // Keeping the stamp there for the rest of its dwell would put the last
  // player's −300 above the new answerer's name — the same shape `Hub.buzz`
  // avoids with the transcript, and avoided there for the same reason. The
  // handover takes the stamp with it rather than waiting out a dwell.
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
  // Ada missed a moment ago; the buzzers are open again and the stamp is still
  // within its dwell.
  s.round.phase = 'ARMED'
  s.round.armedAt = 1000
  s.round.lockedOut = ['a']
  s.round.award = { name: 'Ada', points: -100, penalty: true }
  const dwelling: Local = { ...LOCAL, open: true, retired: false }
  assert.equal(momentOf(s, dwelling), 'verdict:penalty')

  // Bo buzzes. The board sounds the buzz-in on this broadcast, so this is the
  // frame the new name has to be on the wall by — waiting out the rest of the
  // dwell put the sound a second ahead of the picture.
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

  // Ada presses. The order is held back 150ms, and the pair holds the stage
  // for exactly that long rather than flicking to a bare "Ready".
  s.round.phase = 'COLLECTING'
  assert.equal(momentOf(s, live), 'buzz:collecting')
  assert.deepEqual(wallOf(s, live).faceoff, ['Ada', 'Bo'], 'still the pair, briefly')

  // The order lands — the same broadcast the board sounds the buzz-in on, so
  // the name has to be up on this frame and not a locked round later.
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
  // Scored: the phase drops to IDLE, so there is no leader to hold the stage.
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

  // Solo with nothing else on the stage: the name, rather than a bare "Ready"
  // under a +200 belonging to nobody.
  delete s.duel
  delete s.round.buzzable
  const solo = wallOf(s, LOCAL)
  oneOf(solo, 'a solo payoff')
  assert.deepEqual(solo.hero, { name: 'Ada', tone: 'awarded' })

  // And a clue still up does not take it back: a correct answer ends the
  // question, so what is left of it on the stage is spent.
  s.round.fragments = ['A clue.']
  assert.equal(wallOf(s, LOCAL).clue, null)
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'awarded' })
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  assert.equal(wallOf(s, LOCAL).hero?.tone, 'penalised', 'a miss keeps it too, and says why')
})

/**
 * Two clocks, one beat.
 *
 * The board retires a penalty on `--penalty-dwell`, counted from the transcript
 * finishing — `useReveal` will not start it until `settled`. The reader opens
 * the rebound on `autoplay.reboundSec`, counted from the verdict, and resumes
 * speaking in the same instant. Different lengths from different starting
 * instants, related by nothing, so the voice picked the question back up under
 * a stamp still on the wall and a stage with no clue on it.
 *
 * The rule that replaces the arithmetic: while the box is driving, the question
 * resuming is what ends the beat. `state.ts`'s `rebound` already says so —
 * "opening it hands the wall back to the clue, and the clue resumes in the same
 * instant" — and this is the wall keeping that promise.
 */
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

  // The hold is the room's look at the miss, and it is the reader's own clock.
  const held = wallOf(s, LOCAL)
  oneOf(held, 'held')
  assert.equal(held.moment, 'verdict:hold')
  assert.deepEqual(held.hero, { name: 'Bo', tone: 'penalised' })

  // The reader opens it and starts talking. The board's dwell has not elapsed —
  // it had a transcript to type first — and that must not matter.
  delete s.round.held
  s.round.phase = 'ARMED'
  s.round.armedAt = 7000
  const back = wallOf(s, { ...LOCAL, open: true, retired: false })
  oneOf(back, 'handed back')
  assert.equal(back.moment, 'buzz:open', 'the stamp does not outlive the voice')
  assert.equal(back.award, null)
  assert.deepEqual(back.clue, { whole: 'One. Two. Three.', shown: 'One.' })
})

/**
 * A payoff ends the question; a penalty does not. The clue behind a correct
 * answer is spent — nothing more will be read from it — so the name that won is
 * the story, and the room spends `nextSec` looking at it rather than at the
 * question it just answered.
 *
 * Invisible without the box: a host reading aloud pushes no fragments, so there
 * was never a clue to lose the stage to.
 */
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
  assert.deepEqual(w.finale, ['Ada', 'Bo'])
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

test('the finale tells each phone where it finished', () => {
  const mine = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: false, open: false, judging: false }
  assert.equal(phoneOf('idle:finale', { ...mine, place: 1 }).label, 'Winner')
  const second = phoneOf('idle:finale', { ...mine, place: 2 })
  assert.equal(second.label, 'Final')
  assert.equal(second.sub, '2nd place')
  assert.equal(phoneOf('idle:finale', { ...mine, place: 11 }).sub, '11th place')
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
  // Three tied at the value split 200 into 67s; second place's half is 100.
  s.round.guesses = { a: 11, b: 9, c: 11, d: 13 }
  s.round.paid = { a: 67, b: 67, c: 67, d: 100 }
  const marks = wallOf(s, LOCAL).closest!.marks!
  assert.deepEqual(Object.fromEntries(marks.map((m) => [m.id, m.place])), { a: 1, b: 1, c: 1, d: 2 })
})

test('the phone during a closest question', () => {
  const base = { frozen: false, barred: false, spectator: false, dead: false, won: false, pressed: false, armed: true, open: true, judging: false }
  assert.equal(phoneOf('closest:listening', base).label, 'Listen')
  assert.equal(phoneOf('closest:guessing', base).label, 'Guess')
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
  // Ada missed; the rebound is open to everyone and the dwell has long passed.
  s.round.award = { name: 'Ada', points: 0, penalty: true }
  const w = wallOf(s, open)
  assert.equal(w.moment, 'verdict:penalty')
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'penalised' })
  assert.equal(w.award?.scoreless, true, 'stamped as a verdict, not a 0')
  // Bo buzzes: his name replaces hers.
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
