import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import type { InkInput } from '../../../shared/protocol.ts'
import { CARDS } from './fixtures.ts'
import { applyInk, createInkWorld, inkFinished, inkResults, leadingChoice, peekTargets, roleOf } from './world.ts'
import type { InkWorld } from './types.ts'

/** Sun: sw writes, s1 s2 guess. Moon: mw writes, m1 guesses. */
function world(): InkWorld {
  return createInkWorld({
    rand: mulberry32(1),
    cards: CARDS,
    participants: ['m1', 'mw', 's1', 's2', 'sw'],
    lobby: { teams: { sw: 'sun', s1: 'sun', s2: 'sun', mw: 'moon', m1: 'moon' }, volunteers: ['sw', 'mw'] },
  })
}

let at = 0
const act = (w: InkWorld, player: string, input: Record<string, unknown>) =>
  applyInk(w, player, { at: ++at, ...input } as InkInput)

function started(): InkWorld {
  const w = world()
  act(w, 'sw', { kind: 'pickWord', index: 2 })
  act(w, 'mw', { kind: 'pickWord', index: 2 })
  return w
}

test('volunteers write, everyone else guesses, and each team holds seven prompts', () => {
  const w = world()
  assert.deepEqual(w.roster, { sun: { writer: 'sw', guessers: ['s1', 's2'] }, moon: { writer: 'mw', guessers: ['m1'] } })
  assert.equal(w.hands.sun.length, 7)
  assert.equal(w.hands.moon.length, 7)
  assert.equal(w.deck.length, 6)
  assert.equal(w.wordCard.length, 6)
  assert.deepEqual(roleOf(w, 's1'), { team: 'sun', role: 'guesser' })
  assert.equal(roleOf(w, 'stranger'), null)
})

test('without volunteers a team member is drawn as writer', () => {
  const w = createInkWorld({
    rand: mulberry32(3), cards: CARDS, participants: ['a', 'b', 'c', 'd'],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'moon', d: 'moon' }, volunteers: [] },
  })
  assert.ok(['a', 'b'].includes(w.roster.sun.writer))
  assert.equal(w.roster.sun.guessers.length, 1)
})

test('the secret word locks once both writers pick the same word', () => {
  const w = world()
  assert.deepEqual(act(w, 's1', { kind: 'pickWord', index: 1 }), { status: 'refused', reason: 'not-allowed' })
  act(w, 'sw', { kind: 'pickWord', index: 1 })
  act(w, 'mw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, null)
  act(w, 'sw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, 'Chili')
  assert.equal(w.turn, 'sun')
  assert.deepEqual(w.step, { at: 'choose' })
})

test('a vote applies when every guesser agrees', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'guess' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'offer' })
  assert.deepEqual(w.votes, [])
})

test('the other team and the writer cannot vote; invalid choices are refused', () => {
  const w = started()
  assert.equal(act(w, 'm1', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 'sw', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'fly' }).status, 'refused')
})

test('force applies the leading choice, earliest to reach the count on a tie', () => {
  assert.equal(leadingChoice([]), null)
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
  ]), 'guess')
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
    { player: 'c', choice: 'ask', seq: 3 },
  ]), 'ask')
  const w = started()
  assert.equal(act(w, 's1', { kind: 'force' }).status, 'refused')
  act(w, 's1', { kind: 'vote', choice: 'guess' })
  act(w, 's2', { kind: 'force' })
  assert.equal(w.step.at, 'guess')
})

test('prompt pairs match regardless of order', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  act(w, 's1', { kind: 'vote', choice: `${w.hands.sun[0]},${w.hands.sun[1]}` })
  act(w, 's2', { kind: 'vote', choice: `${w.hands.sun[1]},${w.hands.sun[0]}` })
  assert.equal(w.step.at, 'keep')
})

const line: [number, number][] = [[0.1, 0.1], [0.2, 0.9]]

function askUntilClue(w: InkWorld, team: 'sun' | 'moon') {
  const guessers = w.roster[team].guessers
  for (const g of guessers) act(w, g, { kind: 'vote', choice: 'ask' })
  const pair = `${w.hands[team][0]},${w.hands[team][1]}`
  for (const g of guessers) act(w, g, { kind: 'vote', choice: pair })
  const step = w.step
  assert.equal(step.at, 'keep')
  if (step.at !== 'keep') throw new Error('not keep')
  act(w, w.roster[team].writer, { kind: 'keep', prompt: step.offered[0] })
  return step.offered
}

test('asking offers two prompts, keeps one and discards the other', () => {
  const w = started()
  const offered = askUntilClue(w, 'sun')
  assert.equal(w.hands.sun.length, 5)
  assert.deepEqual(w.discard, [offered[1]])
  assert.deepEqual(w.step, { at: 'clue', prompt: offered[0], stopped: false })
  assert.equal(w.pad.sun[0].kind, 'clue')
})

test('stop lets the writer finish the letter; done ends the clue and the turn', () => {
  const w = started()
  askUntilClue(w, 'sun')
  assert.equal(act(w, 'sw', { kind: 'done' }).status, 'refused')
  assert.equal(act(w, 's1', { kind: 'stroke', points: line }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's2', { kind: 'stop' })
  assert.equal(act(w, 'sw', { kind: 'stroke', points: line }).status, 'accepted')
  act(w, 'sw', { kind: 'done' })
  assert.equal(w.pad.sun[0].strokes.length, 2)
  assert.equal(w.pad.sun[0].ended, false)
  assert.equal(w.asked.sun.length, 1)
  assert.equal(w.hands.sun.length, 7)
  assert.equal(w.turn, 'moon')
  assert.deepEqual(w.step, { at: 'choose' })
})

test('end clue adds the period without a stop', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 'sw', { kind: 'endClue' })
  assert.equal(w.pad.sun[0].ended, true)
  assert.equal(w.turn, 'moon')
})

test('only the latest stroke can be undone, once', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 'sw', { kind: 'stroke', points: [[0.5, 0.5]] })
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'accepted')
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'refused')
  assert.equal(w.pad.sun[0].strokes.length, 1)
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(act(w, 'sw', { kind: 'undo' }).status, 'accepted')
  assert.equal(w.pad.sun[0].strokes.length, 1)
})

test('every stroke and undo counts as processed, refused or not', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 'sw', { kind: 'undo' })
  act(w, 'sw', { kind: 'undo' })
  act(w, 'sw', { kind: 'stroke', points: [[9, 9]] })
  act(w, 'sw', { kind: 'endClue' })
  assert.equal(w.inkOps.sw, 4)
  assert.equal(w.inkOps.s1, undefined)
})

test('strokes are validated and rounded to three decimals', () => {
  const w = started()
  askUntilClue(w, 'sun')
  assert.equal(act(w, 'sw', { kind: 'stroke', points: [[2.5, 0]] }).status, 'refused')
  assert.equal(act(w, 'sw', { kind: 'stroke', points: [[1.2, -0.4]] }).status, 'accepted', 'ink may run past the row')
  act(w, 'sw', { kind: 'undo' })
  assert.equal(act(w, 'sw', { kind: 'stroke', points: [] }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: [[0.12345, 0.98765]] })
  assert.deepEqual(w.pad.sun[0].strokes[0].points, [[0.123, 0.988]])
})

test('the live stroke is kept for the writer and cleared on commit', () => {
  const w = started()
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'ink', points: line })
  assert.deepEqual(w.live.sw, line)
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(w.live.sw, undefined)
  assert.equal(act(w, 'm1', { kind: 'ink', points: line }).status, 'refused')
})

test('the prompt deck reshuffles the discard pile when it runs out', () => {
  const w = started()
  w.discard.push(...w.deck)
  w.deck = []
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'endClue' })
  assert.equal(w.hands.sun.length, 7)
})

function voteAll(w: InkWorld, choice: string) {
  for (const g of w.roster[w.turn].guessers) act(w, g, { kind: 'vote', choice })
}

test('a guess is written letter by letter and judged by the writer', () => {
  const w = started()
  voteAll(w, 'guess')
  assert.equal(w.pad.sun[0].kind, 'guess')
  assert.equal(act(w, 's1', { kind: 'check' }).status, 'refused')
  act(w, 's1', { kind: 'stroke', points: line })
  assert.equal(act(w, 's2', { kind: 'stroke', points: line }).status, 'refused')
  act(w, 's1', { kind: 'check' })
  assert.equal(act(w, 'mw', { kind: 'judge', correct: true }).status, 'refused')
  act(w, 'sw', { kind: 'judge', correct: true })
  assert.deepEqual(w.step, { at: 'guess', holder: null })
  act(w, 's2', { kind: 'stroke', points: line })
  act(w, 's2', { kind: 'stroke', points: line })
  assert.equal(act(w, 's2', { kind: 'finishGuess' }).status, 'refused')
  act(w, 's2', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: false })
  assert.deepEqual(w.pad.sun[0].strikes, [[1, 2]])
  assert.equal(w.turn, 'moon')
})

test('finishing a guess asks the writer for a verdict; win ends the game', () => {
  const w = started()
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: true })
  act(w, 's1', { kind: 'finishGuess' })
  assert.equal(w.pad.sun[0].ended, true)
  assert.deepEqual(w.step, { at: 'judgeWord' })
  act(w, 'sw', { kind: 'verdict', win: true })
  assert.equal(inkFinished(w), true)
  assert.deepEqual(inkResults(w).map((r) => r.playerId).sort(), ['s1', 's2', 'sw'])
})

test('not it ends the turn without ending the game', () => {
  const w = started()
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: true })
  act(w, 's1', { kind: 'finishGuess' })
  act(w, 'sw', { kind: 'verdict', win: false })
  assert.equal(inkFinished(w), false)
  assert.equal(w.turn, 'moon')
})

test('redraw replaces the hand once per team and keeps the turn', () => {
  const w = started()
  const before = [...w.hands.sun]
  voteAll(w, 'redraw')
  assert.deepEqual(w.step, { at: 'choose' })
  assert.equal(w.hands.sun.length, 7)
  assert.notDeepEqual(w.hands.sun, before)
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'redraw' }).status, 'refused')
})

/** Plays a sun clue with one stroke and no period, then passes moon's turn with a wrong guess letter. */
function sunClueMoonMiss(w: InkWorld) {
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'stop' })
  act(w, 'sw', { kind: 'done' })
  voteAll(w, 'guess')
  act(w, 'm1', { kind: 'stroke', points: line })
  act(w, 'm1', { kind: 'check' })
  act(w, 'mw', { kind: 'judge', correct: false })
}

test('a turn starting on a peek row picks an unfinished clue and its writer adds one letter', () => {
  const w = started()
  sunClueMoonMiss(w) // sun row 1, moon row 1
  sunClueMoonMiss(w) // sun row 2, moon row 2
  assert.equal(w.turn, 'sun')
  askUntilClue(w, 'sun')
  act(w, 'sw', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'stop' })
  act(w, 'sw', { kind: 'done' }) // sun row 3; moon now starts on row 3, a peek row
  assert.equal(w.turn, 'moon')
  assert.equal(w.row, 2)
  assert.deepEqual(w.step, { at: 'peekPick' })
  assert.deepEqual(peekTargets(w), ['sun:0', 'sun:1', 'sun:2'])
  assert.equal(act(w, 'm1', { kind: 'vote', choice: 'moon:0' }).status, 'refused')
  act(w, 'm1', { kind: 'vote', choice: 'sun:1' })
  assert.equal(w.step.at, 'peekWrite')
  assert.equal(act(w, 'sw', { kind: 'done' }).status, 'refused')
  act(w, 'sw', { kind: 'stroke', points: line })
  assert.equal(w.pad.sun[1].strokes.at(-1)?.peek, true)
  act(w, 'sw', { kind: 'done' })
  assert.deepEqual(w.step, { at: 'choose' })
  assert.equal(w.turn, 'moon')
})

test('a peek row with nothing to peek goes straight to choosing', () => {
  const w = started()
  for (let i = 0; i < 2; i++) {
    voteAll(w, 'guess')
    act(w, 's1', { kind: 'stroke', points: line })
    act(w, 's1', { kind: 'check' })
    act(w, 'sw', { kind: 'judge', correct: false })
    voteAll(w, 'guess')
    act(w, 'm1', { kind: 'stroke', points: line })
    act(w, 'm1', { kind: 'check' })
    act(w, 'mw', { kind: 'judge', correct: false })
  }
  voteAll(w, 'guess')
  act(w, 's1', { kind: 'stroke', points: line })
  act(w, 's1', { kind: 'check' })
  act(w, 'sw', { kind: 'judge', correct: false })
  assert.equal(w.row, 2)
  assert.deepEqual(w.step, { at: 'choose' })
})

test('both teams lose when all sixteen rows fill', () => {
  const w = started()
  for (let i = 0; i < 16; i++) {
    const team = w.turn
    const g = w.roster[team].guessers[0]
    voteAll(w, 'guess')
    act(w, g, { kind: 'stroke', points: line })
    act(w, g, { kind: 'check' })
    act(w, w.roster[team].writer, { kind: 'judge', correct: false })
  }
  assert.deepEqual(w.step, { at: 'over', winner: null })
  assert.deepEqual(inkResults(w), [])
})

test('ask is refused with fewer than two prompts in hand; guess still works', () => {
  const w = started()
  w.deck = []
  w.discard = []
  w.hands.sun = [w.hands.sun[0]]
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.deepEqual(w.step, { at: 'choose' })
  voteAll(w, 'guess')
  assert.equal(w.pad.sun[0].kind, 'guess')
})
