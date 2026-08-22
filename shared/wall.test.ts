import test from 'node:test'
import assert from 'node:assert/strict'
import { momentOf, phoneOf, wallOf, type Local, type Wall } from './wall.ts'
import type { State } from './protocol.ts'

const LOCAL: Local = { open: false, settled: true, retired: false }

function room(): State {
  return {
    grouping: 'solo',
    players: [
      { id: 'a', name: 'Ada', connected: true },
      { id: 'b', name: 'Bo', connected: true },
    ],
    teams: [],
    scores: { a: 0, b: 0 },
    round: { value: 200, phase: 'IDLE', armedAt: 0, order: [], total: 0, lockedOut: [] },
    game: { id: 'trivia', options: {}, moduleState: null },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    setlists: [],
    packs: [],
    packSizes: {},
    mirrorFragments: false,
    answerWindowSec: 0,
    autoplay: { on: false, nextSec: 4, reboundSec: 3 },
  }
}

/**
 * The invariant, mechanically. Those five are the middle band's occupants, and
 * "the clue came back under the transcript" is precisely two of them at once.
 */
function oneOf(w: Wall, why: string) {
  const up = [w.hero, w.clue, w.nominations, w.faceoff, w.call].filter((x) => x !== null)
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
  assert.equal(at().call, 'standby')
  assert.ok(at().filament, 'the warm-up runs through the lead')
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
  assert.ok(!held.filament, 'no warm-up bar under the name it just cost')
  assert.equal(held.value, null)

  // The rebound opens. The clue resumes on a clean wall: the server drops the
  // transcript with the hold, which is what `rebound` in state.ts does.
  delete s.round.held
  delete s.round.spoken
  s.round.phase = 'ARMED'
  s.round.armedAt = 5000
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 4,
    paused: false, running: true,
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
  assert.deepEqual(paid.hero, { name: 'Ada', tone: 'answering' }, 'the winner holds the stage')
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
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'answering' })
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
  assert.deepEqual(w.hero, { name: 'Ada', tone: 'answering' }, 'not back to the pair')
  assert.equal(w.faceoff, null)
  assert.equal(w.award?.points, 200)

  // Solo with nothing else on the stage: the name, rather than a bare "Ready"
  // under a +200 belonging to nobody.
  delete s.duel
  delete s.round.buzzable
  const solo = wallOf(s, LOCAL)
  oneOf(solo, 'a solo payoff')
  assert.deepEqual(solo.hero, { name: 'Ada', tone: 'answering' })

  // And a clue still up does not take it back: a correct answer ends the
  // question, so what is left of it on the stage is spent.
  s.round.fragments = ['A clue.']
  assert.equal(wallOf(s, LOCAL).clue, null)
  assert.deepEqual(wallOf(s, LOCAL).hero, { name: 'Ada', tone: 'answering' })
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
  s.autoplay = { on: true, nextSec: 4, reboundSec: 3 }
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 4,
    paused: false, running: true,
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
  s.reading = {
    pack: 'p', qIndex: 0, qTotal: 3, fragIndex: 3, fragTotal: 4,
    paused: false, running: true,
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
  assert.deepEqual(paid.hero, { name: 'Ada', tone: 'answering' }, 'the winner, not the spent question')
  assert.equal(paid.clue, null)
  assert.equal(paid.award?.answer, 'Marie Curie')
})
