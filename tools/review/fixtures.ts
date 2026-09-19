import { Hub } from '../../server/hub.ts'
import { newState } from '../../server/state.ts'
import type { Conn } from '../../server/hub.ts'
import type { State } from '../../shared/protocol.ts'
import type { ReviewScenario } from '../../client/review/model.ts'
import { INK_PLAYERS, InkGame, inkSession } from './ink.ts'

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
  // The server scores to IDLE and keeps the order up.
  correct.round.phase = 'IDLE'

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

  const frozen = question()
  frozen.effects = [{ kind: 'frozen', playerId: 'ada', attemptId: frozen.round.attemptId }]

  const faceoff = base()
  faceoff.duel = {
    rule: 'vote',
    pool: [
      { playerId: 'ada', votes: ['cy'], in: false },
      { playerId: 'bo', votes: [], in: false },
    ],
    missed: [],
    seated: ['ada', 'bo'],
  }

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

  const inkState = (phase: 'ready' | 'playing') => {
    const state = base()
    state.players = structuredClone(INK_PLAYERS)
    state.scores = Object.fromEntries(INK_PLAYERS.map((player) => [player.id, 0]))
    state.minigame = inkSession(phase)
    return state
  }
  const ink = (id: string, label: string, reach: (game: InkGame) => void): ReviewScenario => {
    const game = new InkGame()
    reach(game)
    const state = inkState('playing')
    return {
      id, label,
      board: project(state, 'board'),
      boardFrame: game.board(),
      phones: state.players.map((player) => ({
        playerId: player.id,
        label: player.name,
        state: project(state, 'player', player.id),
        pressed: false,
        frame: game.phone(player.id),
      })),
      presentation: at(),
    }
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
    build('frozen', 'Frozen by an item', frozen, at({ open: true })),
    build('duel', 'Duel selection', duel, at()),
    build('faceoff', 'Face-off seated', faceoff, at()),
    build('setlist-complete', 'Setlist complete', spent, at()),
    build('ink-lobby', 'Ink teams forming', inkState('ready'), at()),
    ink('ink-choosing', 'Ink word choice', (game) => {
      game.play('di', { kind: 'pickWord', index: 2, at: 0 })
    }),
    ink('ink-choose', 'Ink ask or guess vote', (game) => {
      game.chooseWord()
      game.vote('ask', [game.guessers()[0]])
    }),
    ink('ink-offer', 'Ink prompt offer', (game) => {
      game.chooseWord().vote('ask')
    }),
    ink('ink-keep', 'Ink writer keeps a prompt', (game) => {
      game.chooseWord().offer()
    }),
    ink('ink-clue', 'Ink clue in progress', (game) => {
      game.chooseWord().ask()
      game.stroke(game.writer())
    }),
    ink('ink-clue-stopped', 'Ink clue stopped', (game) => {
      game.chooseWord().ask()
      game.stroke(game.writer())
      game.play(game.guessers()[0], { kind: 'stop', at: 0 })
    }),
    ink('ink-guess', 'Ink guess in progress', (game) => {
      game.chooseWord()
      game.clueTurn()
      game.clueTurn()
      game.leavePeek()
      game.vote('guess')
      game.spell(2)
    }),
    ink('ink-guess-missed', 'Ink guess missed', (game) => {
      game.chooseWord()
      game.clueTurn()
      game.clueTurn()
      game.leavePeek()
      game.vote('guess')
      game.spell(2)
      game.missLetter()
    }),
    ink('ink-peek', 'Ink peek pick', (game) => {
      game.chooseWord()
      for (let i = 0; i < 6; i++) game.clueTurn()
    }),
    ink('ink-over', 'Ink word found', (game) => {
      game.chooseWord()
      game.clueTurn()
      game.clueTurn()
      game.leavePeek()
      game.vote('guess')
      game.spell(Infinity)
    }),
  ]
}
