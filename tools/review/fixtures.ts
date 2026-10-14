import { Hub } from '../../server/hub.ts'
import { newState } from '../../server/state.ts'
import type { Conn } from '../../server/hub.ts'
import type { State } from '../../shared/protocol.ts'
import type { PracticeFeedback } from '../../client/arrival-feedback.ts'
import type { ReviewScenario } from '../../client/review/model.ts'
import { INK_LONG_NAMES, INK_PLAYERS, InkGame, inkSession } from './ink.ts'
import { SKETCH_PLAYERS, SketchGame, sketchSession } from './sketch.ts'

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
    now: NOW, open: false, settled: true, retired: false, ...overrides,
  })

  const welcome = base()
  welcome.scores = { ada: 0, bo: 0, cy: 0 }

  const waiting = base()
  const setlistBlocks = [
    { game: 'trivia', options: {}, count: 3 },
    { game: 'quizbowl', options: { powerAfterFragment: 2 }, count: 2 },
  ]
  const setlistTrivia = structuredClone(waiting)
  setlistTrivia.setlist = { blocks: setlistBlocks, at: 0, done: 1 }

  const delay = question()
  delay.round.armedAt = NOW + 200

  const open = question()

  const shownReading = question()
  shownReading.round.kind = 'shown'
  shownReading.round.value = 200
  shownReading.round.fragments = ['What country is home to the city of Timbuktu?']
  shownReading.round.whole = shownReading.round.fragments[0]

  const quizbowlReading = question()
  quizbowlReading.game = {
    id: 'quizbowl',
    options: { powerAfterFragment: 2, powerBonus: 50, neg: 0, bouncebacks: true, itemsEnabled: false },
    moduleState: {},
  }
  quizbowlReading.round.value = 100
  quizbowlReading.round.fragments = [
    'This thing has a version supposedly named for Queen Margherita on a visit to Naples.',
  ]
  quizbowlReading.round.whole = [
    quizbowlReading.round.fragments[0],
    'Chicago and New York still argue over how thick it should be.',
    'Name this dish of baked dough, tomato sauce and cheese, often sold by the slice.',
  ].join(' ')
  const setlistQuizbowl = structuredClone(quizbowlReading)
  setlistQuizbowl.setlist = { blocks: setlistBlocks, at: 1, done: 0 }

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
  correct.scores.ada += 400
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
  wrong.scores.ada -= 100

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

  // Four in the room: two on one answer, one on another, one yet to pick.
  const picking = question()
  picking.players.push({ id: 'di', name: 'Di', connected: true })
  picking.scores.di = 0
  picking.round.kind = 'choice'
  picking.round.fragments = ['Which planet has the most known moons?']
  picking.round.whole = 'Which planet has the most known moons?'
  picking.round.choices = ['Mars', 'Venus', 'Saturn', 'Jupiter']
  picking.round.picks = { ada: 2, cy: 2, bo: 3 }
  picking.round.closesAt = NOW + 12_000

  const revealed = structuredClone(picking)
  revealed.round.correct = 2
  revealed.round.phase = 'IDLE'
  revealed.scores = { ada: 1000, bo: 400, cy: 600, di: 0 }

  // Seven in the room, four in; nobody's number is on the wall yet.
  const guessing = question()
  for (const [id, name] of [['di', 'Di'], ['ed', 'Ed'], ['fen', 'Fen'], ['gus', 'Gus']]) {
    guessing.players.push({ id, name, connected: true })
    guessing.scores[id] = 0
  }
  guessing.round.kind = 'closest'
  guessing.round.fragments = ['How many steps are in the Eiffel Tower to the top?']
  guessing.round.whole = 'How many steps are in the Eiffel Tower to the top?'
  guessing.round.guessing = { unit: 'steps', closesAt: NOW + 12_000 }
  guessing.round.guesses = { ada: 1700, cy: 1500, bo: 1200, di: 1720 }

  // Everyone in: a cluster near the answer, one wild guess parked at the end.
  const lined = structuredClone(guessing)
  lined.round.guesses = { ada: 1700, cy: 1500, bo: 1200, di: 1720, ed: 1650, fen: 900, gus: 25000 }
  lined.round.truth = 1665
  lined.round.paid = { ed: 200, ada: 100 }
  lined.round.phase = 'IDLE'
  lined.scores = { ...lined.scores, ed: 200, ada: 100 }

  const inkState = (phase: 'ready' | 'playing', names: Record<string, string> = {}) => {
    const state = base()
    state.players = INK_PLAYERS.map((player) => ({ ...player, name: names[player.id] ?? player.name }))
    state.scores = Object.fromEntries(INK_PLAYERS.map((player) => [player.id, 0]))
    state.minigame = inkSession(phase)
    return state
  }
  const ink = (id: string, label: string, reach: (game: InkGame) => void, names?: Record<string, string>): ReviewScenario => {
    const game = new InkGame()
    reach(game)
    const state = inkState('playing', names)
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

  const sketchState = (session: ReturnType<typeof sketchSession>) => {
    const state = base()
    state.players = structuredClone(SKETCH_PLAYERS)
    // A finished match has already been added to the night, as the hub does.
    state.scores = Object.fromEntries(SKETCH_PLAYERS.map((player) => [
      player.id, session.results?.find((result) => result.playerId === player.id)?.points ?? 0,
    ]))
    state.minigame = session
    return state
  }
  const sketch = (id: string, label: string, reach: (game: SketchGame) => void): ReviewScenario => {
    const game = new SketchGame(NOW)
    reach(game)
    const state = sketchState(sketchSession('playing'))
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
  const sketchResults = sketchState(sketchSession('results', [
    { playerId: 'cy', points: 612, shots: 0 },
    { playerId: 'ada', points: 540, shots: 0 },
    { playerId: 'fay', points: 488, shots: 0 },
    { playerId: 'bo', points: 301, shots: 0 },
    { playerId: 'di', points: 220, shots: 0 },
    { playerId: 'eve', points: 95, shots: 0 },
  ]))

  // Arrival. Pulses are frozen against a fixed local clock, so the screen shows a
  // lit moment without any time passing.
  const lobby = (players: State['players'], tested: string[]) => {
    const state = base()
    state.players = players
    state.scores = Object.fromEntries(players.map((player) => [player.id, 0]))
    state.arrival = { kind: 'lobby', id: 'review-lobby', testedPlayerIds: tested }
    return state
  }
  const PULSE_NOW = 5_000
  const pulses = (...received: [string, number][]): PracticeFeedback => ({
    lobbyId: 'review-lobby',
    pulses: Object.fromEntries(received.map(([id, receivedAt], i) => [id, { seq: i + 1, receivedAt }])),
  })
  const arrivalScenario = (
    id: string, label: string, state: State, extra: Partial<ReviewScenario> = {},
  ): ReviewScenario => ({ ...build(id, label, state, at()), ...extra })
  const crowd = [
    'Ada', 'Bo', 'Cy', 'Di', 'Eve', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun',
    'Wolfeschlegelsteinhausen', 'Maximiliana Featherstonehaugh',
  ].map((name, i) => ({ id: `p${i}`, name, connected: true }))
  const introduction = (state: State, game: string) => {
    state.setlist = { blocks: [{ game, options: {}, count: 3 }], at: 0, done: 0 }
    state.arrival = { kind: 'introduction', id: 'review-intro', blockAt: 0, blockKey: '0:trivia' }
    return state
  }
  const introTrivia = introduction(base(), 'trivia')
  const introMinigame = introduction(base(), 'tank')
  const introOverVerdict = introduction(structuredClone(correct), 'trivia')
  const introOverChoice = introduction(structuredClone(revealed), 'trivia')
  const emptyLobby = lobby([], [])
  const emptyLobbyScenario = arrivalScenario('lobby-empty', 'Arrival lobby, nobody joined', emptyLobby, {
    phones: [{
      playerId: 'guest', label: 'Not joined', state: project(emptyLobby, 'player', 'guest'), pressed: false,
    }],
  })
  const disconnectedLobby = lobby(base().players, ['ada'])
  const disconnectedScenario = arrivalScenario('lobby-disconnected', 'Arrival lobby, phone disconnected', disconnectedLobby)
  disconnectedScenario.phones = disconnectedScenario.phones.map((phone) => ({ ...phone, connected: false }))

  return [
    build('welcome', 'Welcome', welcome, at()),
    build('waiting', 'Waiting between questions', waiting, at()),
    build('setlist-trivia', 'Setlist: Trivia, question 2 of 3', setlistTrivia, at()),
    build('delay', 'Arm delay', delay, at()),
    build('open', 'Question open', open, at({ open: true })),
    build('shown-reading', 'Shown question, reading', shownReading, at({ open: true })),
    build('quizbowl-reading', 'Quizbowl-lite, first fragment', quizbowlReading, at({ open: true })),
    build('setlist-quizbowl', 'Setlist: Quizbowl-lite, question 1 of 2', setlistQuizbowl, at({ open: true })),
    build('collecting', 'Collecting buzzes', collecting, at({ open: true })),
    build('leader-answering', 'Leader answering', answering, at()),
    build('correct', 'Correct award', correct, at()),
    build('wrong-hold', 'Wrong answer hold', wrong, at({ settled: true })),
    build('rebound', 'Rebound with lockout', rebound, at({ open: true })),
    build('frozen', 'Frozen by an item', frozen, at({ open: true })),
    build('duel', 'Duel selection', duel, at()),
    build('faceoff', 'Face-off seated', faceoff, at()),
    build('setlist-complete', 'Setlist complete', spent, at()),
    build('choice-picking', 'Choice question, picking', picking, at({ open: true })),
    build('choice-reveal', 'Choice question, revealed', revealed, at()),
    build('closest-guessing', 'Closest question, guessing', guessing, at({ open: true })),
    build('closest-reveal', 'Closest question, revealed', lined, at()),
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
    // Names have no length limit, so the chin, the phone bar and the lobby have to cope.
    ink('ink-long-names', 'Ink with long names', (game) => {
      game.chooseWord()
      game.clueTurn()
      game.clueTurn()
      game.leavePeek()
      game.vote('guess')
      game.spell(2)
    }, INK_LONG_NAMES),
    build('ink-lobby-long-names', 'Ink teams forming, long names', inkState('ready', INK_LONG_NAMES), at()),
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
    build('sketch-lobby', 'Sketch lobby', sketchState(sketchSession('ready')), at()),
    sketch('sketch-choosing', 'Sketch word choice', () => {}),
    sketch('sketch-drawing', 'Sketch drawing, guesses flying', (game) => {
      game.pick().wait(3).draw()
      game.misses(4).guess(game.guessers[2], game.word).wait(20)
      game.close(game.guessers[0]).misses(6).guess(game.guessers[4], game.word).wait(24)
    }),
    sketch('sketch-reveal-time', 'Sketch time ran out', (game) => {
      game.pick().draw().misses(9).guess(game.guessers[1], game.word).wait(80)
    }),
    sketch('sketch-reveal-all', 'Sketch everyone got it', (game) => {
      game.pick().draw().misses(3)
      for (const [i, id] of game.guessers.entries()) game.wait(2 + i).guess(id, game.word)
    }),
    build('sketch-results', 'Sketch results', sketchResults, at()),
    emptyLobbyScenario,
    arrivalScenario('lobby-crowd', 'Arrival lobby, twelve players, long names', lobby(crowd, ['p0', 'p2', 'p3', 'p10', 'p11'])),
    arrivalScenario('lobby-own-pulse', 'Arrival lobby, own accepted pulse', lobby(base().players, ['ada']), {
      practice: pulses(['ada', PULSE_NOW - 150]), practiceNow: PULSE_NOW,
    }),
    arrivalScenario('lobby-simultaneous', 'Arrival lobby, simultaneous pulses', lobby(base().players, ['ada', 'bo', 'cy']), {
      practice: pulses(['ada', PULSE_NOW - 200], ['bo', PULSE_NOW - 120], ['cy', PULSE_NOW - 40]), practiceNow: PULSE_NOW,
    }),
    arrivalScenario('lobby-tested-reconnected', 'Arrival lobby, tested phone back with no pulse', lobby(base().players, ['ada', 'bo']), {
      practice: pulses(), practiceNow: PULSE_NOW,
    }),
    disconnectedScenario,
    arrivalScenario('intro-trivia', 'Introduction, Trivia first block', introTrivia),
    arrivalScenario('intro-minigame', 'Introduction, minigame first block', introMinigame),
    arrivalScenario('intro-over-verdict', 'Introduction over a retained verdict', introOverVerdict),
    arrivalScenario('intro-over-choice', 'Introduction over a retained choice reveal', introOverChoice),
  ]
}
