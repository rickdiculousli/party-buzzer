import { Hub } from '../../server/hub.ts'
import { newState } from '../../server/state.ts'
import type { Conn } from '../../server/hub.ts'
import type { State } from '../../shared/protocol.ts'
import type { ReviewScenario } from '../../client/review/model.ts'

const NOW = 1_800_000_000_000

function project(state: State, role: Conn['role'], playerId?: string): State {
  const hub = new Hub(structuredClone(state))
  return hub.viewFor({ id: `${role}:${playerId ?? 'room'}`, role, playerId, send: () => {} })
}

export function makeReviewScenarios(): ReviewScenario[] {
  const base = () => {
    const state = newState()
    state.players = [
      { id: 'ada', name: 'Ada', connected: true },
      { id: 'bo', name: 'Bo', connected: true },
      { id: 'cy', name: 'Cy', connected: true },
    ]
    state.scores = { ada: 600, bo: 400, cy: 200 }
    return state
  }
  const question = (phase: State['round']['phase'] = 'ARMED') => {
    const state = base()
    state.readingActive = true
    state.reading = {
      pack: 'review.txt', qIndex: 2, qTotal: 10, fragIndex: 1, fragTotal: 3, paused: false,
    }
    state.round = {
      questionId: 'review-question',
      attemptId: `review-${phase.toLowerCase()}`,
      value: 400,
      phase,
      armedAt: NOW - 1_000,
      order: [],
      total: 0,
      lockedOut: [],
      fragments: ['This question has begun'],
      whole: 'This question has begun and still has words left to reveal.',
    }
    return state
  }
  const build = (
    id: string,
    label: string,
    state: State,
    presentation: ReviewScenario['presentation'],
  ): ReviewScenario => ({
    id,
    label,
    board: project(state, 'board'),
    phones: state.players.map((player) => ({
      playerId: player.id,
      label: player.name,
      state: project(state, 'player', player.id),
      pressed: state.round.order.some((entry) => entry.playerId === player.id),
    })),
    presentation,
  })
  const at = (overrides: Partial<ReviewScenario['presentation']> = {}) => ({
    now: NOW, open: false, delay: 0, settled: true, retired: false, ...overrides,
  })

  const welcome = base()
  welcome.scores = { ada: 0, bo: 0, cy: 0 }

  const waiting = base()

  const delay = question()
  delay.round.armedAt = NOW + 200

  const open = question()

  const collecting = question('COLLECTING')
  collecting.round.order = [
    { playerId: 'ada', name: 'Ada', at: NOW - 300, deltaMs: 0 },
    { playerId: 'bo', name: 'Bo', at: NOW - 180, deltaMs: 120 },
  ]
  collecting.round.total = 2

  const answering = question('LOCKED')
  answering.round.order = [{ playerId: 'ada', name: 'Ada', at: NOW - 300, deltaMs: 0 }]
  answering.round.total = 1
  answering.round.judge = { until: NOW + 7_000 }

  const correct = structuredClone(answering)
  delete correct.round.judge
  correct.round.spoken = { name: 'Ada', transcript: 'the Pacific Ocean', hit: true }
  correct.round.award = { name: 'Ada', points: 400 }
  correct.round.answer = 'Pacific Ocean'

  const wrong = structuredClone(answering)
  delete wrong.round.judge
  wrong.round.order = []
  wrong.round.total = 1
  wrong.round.lockedOut = ['ada']
  wrong.round.held = true
  wrong.round.spoken = { name: 'Ada', transcript: 'the Atlantic Ocean', hit: false }
  wrong.round.award = { name: 'Ada', points: -100, penalty: true }
  wrong.round.answer = 'Pacific Ocean'

  const rebound = structuredClone(wrong)
  rebound.round.phase = 'ARMED'
  rebound.round.attemptId = 'review-rebound'
  rebound.round.armedAt = NOW - 100
  delete rebound.round.held

  const duel = base()
  duel.duel = {
    rule: 'vote',
    pool: [
      { playerId: 'ada', votes: ['bo', 'cy'], in: false },
      { playerId: 'bo', votes: ['ada'], in: false },
      { playerId: 'cy', votes: [], in: false },
    ],
    missed: [],
  }

  const spent = base()
  spent.setlist = {
    blocks: [{ game: 'trivia', options: {}, count: 3 }],
    at: 1,
    done: 0,
  }

  return [
    build('welcome', 'Welcome', welcome, at()),
    build('waiting', 'Waiting between questions', waiting, at()),
    build('delay', 'Arm delay', delay, at({ delay: 200 })),
    build('open', 'Question open', open, at({ open: true })),
    build('collecting', 'Collecting buzzes', collecting, at({ open: true })),
    build('leader-answering', 'Leader answering', answering, at()),
    build('correct', 'Correct award', correct, at()),
    build('wrong-hold', 'Wrong answer hold', wrong, at({ settled: true })),
    build('rebound', 'Rebound with lockout', rebound, at({ open: true })),
    build('duel', 'Duel selection', duel, at()),
    build('setlist-complete', 'Setlist complete', spent, at()),
  ]
}
