import test from 'node:test'
import assert from 'node:assert/strict'
import { arrivalBlocksPlay, arrivalPresentation, introductionFor, practiceAllowed } from './arrival.ts'
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
  intro.arrival = { kind: 'introduction', id: 'lobby-a', blockAt: 0 }
  assert.equal(practiceAllowed(intro, 'ada', 'lobby-a'), false, 'an introduction is not a lobby')
})

test('only an introduction blocks play; a lobby is exited by play instead', () => {
  const s = newState()
  assert.equal(arrivalBlocksPlay(s), false)
  s.arrival = { kind: 'lobby', id: 'l', testedPlayerIds: [] }
  assert.equal(arrivalBlocksPlay(s), false)
  s.arrival = { kind: 'introduction', id: 'i', blockAt: 0 }
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
    phone: 'Your controls and crew appear when the host opens the match.',
  })
  assert.deepEqual(introductionFor('ink'), {
    title: 'Phantom Ink',
    goal: 'Help your team find the secret word',
    phone: 'Choose a team when the host opens the game.',
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
  full.arrival = { kind: 'introduction', id: 'i', blockAt: 0 }
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
  assert.deepEqual(shown, { kind: 'introduction', ...introductionFor('quizbowl') })
  assert.deepEqual(arrivalPresentation(redacted), shown)
  const text = JSON.stringify(shown)
  for (const secret of ['Secret', 'secret.txt', '"A"', 'qIndex']) assert.ok(!text.includes(secret), secret)

  full.arrival = { kind: 'lobby', id: 'l', testedPlayerIds: ['ada'] }
  assert.deepEqual(arrivalPresentation(full), { kind: 'lobby' })
})
