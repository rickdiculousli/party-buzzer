import test from 'node:test'
import assert from 'node:assert/strict'
import { arrivalBlocksPlay, arrivalPresentation, introductionFor, introductionLine, practiceAllowed } from './arrival.ts'
import { newState } from '../server/state.ts'
import type { State } from './protocol.ts'

function lobbyRoom(): State {
  const s = newState()
  s.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: false },
  ]
  s.arrival = { kind: 'lobby', id: 'lobby-a', testedPlayerIds: [] }
  return s
}

test('practice is allowed only for a connected roster member of the current lobby', () => {
  const s = lobbyRoom()
  assert.equal(practiceAllowed(s, 'ada', 'lobby-a'), true)
  assert.equal(practiceAllowed(s, 'ada', 'lobby-old'), false, 'wrong lobby')
  assert.equal(practiceAllowed(s, 'bo', 'lobby-a'), false, 'disconnected')
  assert.equal(practiceAllowed(s, 'cy', 'lobby-a'), false, 'not on the roster')

  const reading = lobbyRoom()
  reading.readingActive = true
  assert.equal(practiceAllowed(reading, 'ada', 'lobby-a'), false)

  const minigame = lobbyRoom()
  minigame.minigame = {
    id: 'bow', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [],
  }
  assert.equal(practiceAllowed(minigame, 'ada', 'lobby-a'), false)

  const intro = lobbyRoom()
  intro.arrival = { kind: 'introduction', id: 'lobby-a', blockAt: 0, blockKey: '0:trivia' }
  assert.equal(practiceAllowed(intro, 'ada', 'lobby-a'), false, 'an introduction is not a lobby')
})

test('only an introduction blocks play; a lobby is exited by play instead', () => {
  const s = newState()
  assert.equal(arrivalBlocksPlay(s), false)
  s.arrival = { kind: 'lobby', id: 'l', testedPlayerIds: [] }
  assert.equal(arrivalBlocksPlay(s), false)
  s.arrival = { kind: 'introduction', id: 'i', blockAt: 0, blockKey: '0:trivia' }
  assert.equal(arrivalBlocksPlay(s), true)
})

test('introduction copy matches the spec rows and falls back generically', () => {
  assert.deepEqual(introductionFor('trivia'), {
    title: 'Trivia',
    goal: 'Answer questions to earn points',
    phone: 'Buzz to answer. If choices appear, pick one.',
  })
  assert.deepEqual(introductionFor('quizbowl'), {
    title: 'Quizbowl-lite',
    goal: 'Buzz when you know the answer',
    phone: 'Listen to the clues, then buzz to answer.',
  })
  assert.deepEqual(introductionFor('bow'), {
    title: 'Bow',
    goal: 'Hit targets to earn points',
    phone: 'Drag down and release when the match starts.',
  })
  assert.deepEqual(introductionFor('tank'), {
    title: 'Tank battle',
    goal: 'Work with your crew to earn points',
    phone: 'Your controls and crew appear when the match opens.',
  })
  assert.deepEqual(introductionFor('ink'), {
    title: 'Phantom Ink',
    goal: 'Help your team find the secret word',
    phone: 'Choose a team when the match opens.',
  })
  assert.deepEqual(introductionFor('charades'), {
    title: 'charades',
    goal: 'The host will explain this game',
    phone: 'Wait for the host to begin',
  })
  assert.deepEqual(introductionFor('toString'), {
    title: 'toString',
    goal: 'The host will explain this game',
    phone: 'Wait for the host to begin',
  }, 'prototype keys are not registry entries')
})

test('arrival presentation is the same from full and redacted state and carries no pack content', () => {
  assert.equal(arrivalPresentation(newState()), null)

  const full = newState()
  full.setlist = { blocks: [{ game: 'quizbowl', options: {}, count: 3, pack: 'secret.txt' }], at: 0, done: 0 }
  full.arrival = { kind: 'introduction', id: 'i', blockAt: 0, blockKey: '0:trivia' }
  full.round = {
    ...full.round, phase: 'IDLE', questionId: 'q', fragments: ['Secret clue'], whole: 'Secret clue whole',
    answer: 'Secret answer', choices: ['A', 'B'], correct: 1, award: { name: 'Ada', points: 100 },
  }
  full.reading = { pack: 'secret.txt', qIndex: 2, qTotal: 3, fragIndex: 1, fragTotal: 2, paused: false }
  // What a phone receives: the round and reader progress stripped.
  const redacted: State = {
    ...full,
    round: { ...full.round, fragments: undefined, whole: undefined, answer: undefined },
    reading: undefined,
  }

  const shown = arrivalPresentation(full)
  assert.deepEqual(shown, { kind: 'introduction', ...introductionFor('quizbowl'), detail: '3 questions', next: false })
  assert.deepEqual(arrivalPresentation(redacted), shown)
  const text = JSON.stringify(shown)
  for (const secret of ['Secret', 'secret.txt', '"A"', 'qIndex']) assert.ok(!text.includes(secret), secret)

  full.arrival = { kind: 'lobby', id: 'l', testedPlayerIds: ['ada'] }
  assert.deepEqual(arrivalPresentation(full), { kind: 'lobby' })
})

test('the composed line names the quiz block\'s count, value and duel rule, and a minigame\'s Ready', () => {
  const s = newState()
  s.duelRules = [{ id: 'vote', name: 'Vote', entry: 'vote', resolve: 'votes' }]
  s.setlist = {
    blocks: [
      { game: 'trivia', options: {}, count: 5, value: 200, duel: 'vote' },
      { game: 'trivia', options: {}, count: 1 },
      { game: 'sketch', options: {}, count: 1 },
      { game: 'poker', options: {}, count: 1 },
    ],
    at: 0,
    done: 0,
  }
  const intro = (at: number) => {
    s.arrival = { kind: 'introduction', id: `i${at}`, blockAt: at, blockKey: `${at}:x` }
    const shown = arrivalPresentation(s)
    assert.equal(shown?.kind, 'introduction')
    return shown as Extract<typeof shown, { kind: 'introduction' }>
  }

  assert.equal(intro(0).detail, '5 questions · 200 points · Duels: Vote')
  assert.equal(intro(0).next, false)
  assert.equal(intro(1).detail, '1 question')

  // A minigame promises Ready only when autoplay will open it; Poker never.
  assert.equal(intro(2).detail, undefined)
  s.autoplay.on = true
  assert.equal(intro(2).detail, 'Tap Ready')
  assert.equal(intro(2).next, true)
  assert.equal(intro(3).detail, undefined, 'the host opens Poker')
  assert.equal(introductionLine(intro(2)), 'Next: Sketch. Draw the word, or guess it fast. Tap Ready.')
  assert.equal(introductionLine(intro(0)), 'Trivia. Answer questions to earn points. 5 questions · 200 points · Duels: Vote.')
})
