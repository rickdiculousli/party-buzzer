import test from 'node:test'
import assert from 'node:assert/strict'
import { momentOf, phoneOf, wallOf, type Local, type Wall } from './wall.ts'
import type { State } from './protocol.ts'

const LOCAL: Local = { open: false, settled: true, retired: false }

function room(): State {
  return {
    mode: 'solo',
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
    flows: [],
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
  // A penalty is a beat, not a state. While it is un-retired it keeps the
  // stage, and the clue stays off — that is the room reading the −300 against
  // the name it cost.
  const beat = at({ open: true })
  assert.equal(beat.moment, 'verdict:penalty', 'the stamp rides the rebound')
  assert.deepEqual(beat.hero, { name: 'Bo', tone: 'penalised' })
  assert.equal(beat.clue, null)

  // In the reader's own timing the beat is already over by the time the
  // buzzers open: the dwell is 2.2s and reboundSec is 3. So the clue picks back
  // up *as* the rebound opens, which is what the checklist watches for.
  const on = at({ open: true, retired: true })
  assert.equal(on.moment, 'buzz:open')
  assert.equal(on.award, null)
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
  assert.deepEqual(paid.clue?.shown, 'One.', 'the payoff sits over the question, not instead of it')
})

test('a duel: nominations, the seat, and both missing', () => {
  const s = room()
  s.duel = { rule: 'vote', pool: [{ playerId: 'a', votes: ['b'], in: true }], missed: [] }
  assert.equal(momentOf(s, LOCAL), 'duel:nominating')
  oneOf(wallOf(s, LOCAL), 'nominating')
  assert.equal(wallOf(s, LOCAL).nominations, 'solo')

  s.mode = 'teams'
  assert.equal(wallOf(s, LOCAL).nominations, 'teams')

  s.duel.seated = ['a', 'b']
  assert.equal(momentOf(s, LOCAL), 'duel:faceoff')
  assert.deepEqual(wallOf(s, LOCAL).faceoff, ['Ada', 'Bo'])

  // `[]`, not absent. The fall-through would otherwise invite the whole room to
  // buzz on a question nobody may answer.
  s.round.candidates = []
  assert.equal(momentOf(s, LOCAL), 'duel:dead')
  assert.equal(wallOf(s, LOCAL).call, 'dead')
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
    won: false, pressed: false, armed: false, open: false,
  }
  assert.equal(phoneOf('idle:ready', mine).label, 'Wait')
  assert.equal(phoneOf('buzz:arming', { ...mine, armed: true }).sub, 'Any moment')
  assert.equal(phoneOf('buzz:open', { ...mine, armed: true, open: true }).label, 'Buzz')
  assert.equal(phoneOf('buzz:collecting', { ...mine, armed: true, pressed: true }).label, 'In')

  assert.equal(phoneOf('answer:locked', { ...mine, won: true }).label, 'You’re up')
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
    phoneOf('buzz:open', { ...mine, spectator: true, finalistNames: ['Ada', 'Bo'] }).sub,
    'Ada vs Bo — you sit this one out',
  )
  // Frozen and barred outrank everything, including being the one answering.
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, frozen: true }).label, 'Frozen')
  assert.equal(phoneOf('answer:locked', { ...mine, won: true, barred: true }).label, 'Out')
})

test('a penalty comes down when someone takes the question over', () => {
  // `wrong` re-stamps the award negative and leaves it standing through the
  // rebound (server/state.ts), so an award can genuinely be up at LOCKED. The
  // old board kept the stamp there for the rest of its dwell — which put the
  // last player's −300 above the new answerer's name, the same shape as the
  // transcript bug fixed in `Hub.buzz` and fixed there for the same reason.
  //
  // This is the one deliberate behaviour change in the board's conversion: the
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
