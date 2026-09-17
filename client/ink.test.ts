import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_MS, draftCanUndo, draftStroke, draftUndo, liveDraft, freshTouches, lobbyColumns, quantizePoint, stepLine, strokePath, teamCap, TOUCH_MS, waitLine } from './ink.ts'
import { newState } from '../server/state.ts'

test('team capacity is half the room, rounded up', () => {
  assert.equal(teamCap(0), 0)
  assert.equal(teamCap(5), 3)
  assert.equal(teamCap(6), 3)
})

test('lobby columns count connected members and flag overfill', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
    { id: 'c', name: 'Cy', connected: true },
    { id: 'd', name: 'Dee', connected: false },
  ]
  state.minigame = {
    id: 'ink', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'sun', d: 'moon' }, volunteers: ['b'] },
  }
  const [sun, moon] = lobbyColumns(state)
  assert.equal(sun.count, 3)
  assert.equal(sun.cap, 2)
  assert.equal(sun.over, true)
  assert.deepEqual(sun.members.map((m) => [m.name, m.volunteer]), [['Ada', false], ['Bo', true], ['Cy', false]])
  assert.equal(moon.count, 0)
  assert.equal(moon.over, false)
})

test('stroke paths scale normalized points; a dot becomes a short segment', () => {
  assert.equal(strokePath([[0, 0], [0.5, 1]], 100, 20), 'M0 0L50 20')
  assert.equal(strokePath([[0.1, 0.5]], 100, 20), 'M10 10l0.01 0')
})

test('points may run past the row, clamp to the reach and round to three decimals', () => {
  assert.deepEqual(quantizePoint(-0.2, 0.12345), [-0.2, 0.123])
  assert.deepEqual(quantizePoint(1.5, 0.9996), [1.5, 1])
  assert.deepEqual(quantizePoint(-3, 9), [-1, 2])
})

test('touches expire after the fade', () => {
  const touch = { playerId: 'a', name: 'Ada', target: 'card:1', x: 0, y: 0 }
  const kept = freshTouches([{ ...touch, at: 0 }, { ...touch, at: 500 }], TOUCH_MS + 1)
  assert.deepEqual(kept.map((t) => t.at), [500])
})

test('step lines name the team, the writer action, and a stopped clue', () => {
  const nameOf = (id: string) => (id === 'ada' ? 'Ada' : '?')
  assert.equal(stepLine({ turn: 'sun', step: { at: 'choosing' } }, nameOf), 'Writers are choosing the secret word')
  assert.equal(stepLine({ turn: 'sun', step: { at: 'clue', stopped: false } }, nameOf), 'Sun writer is writing')
  assert.equal(stepLine({ turn: 'sun', step: { at: 'clue', stopped: true } }, nameOf), 'Sun called Stop')
})

test('an idle phone names the kind of wait, not the room detail', () => {
  assert.equal(waitLine({ at: 'choose', canRedraw: true }, 'sun', 'sun'), 'Your team · deciding')
  assert.equal(waitLine({ at: 'choose', canRedraw: true }, 'sun', 'moon'), 'Other team · deciding')
  assert.equal(waitLine({ at: 'clue', stopped: false }, 'sun', 'moon'), 'Other team · writer writing')
  assert.equal(waitLine({ at: 'keep' }, 'moon', 'moon'), 'Your team · writer picking')
})

test('a guess names its holder, or the team while it is open', () => {
  const nameOf = (id: string) => (id === 'ada' ? 'Ada' : '?')
  assert.equal(stepLine({ turn: 'moon', step: { at: 'guess', holder: 'ada' } }, nameOf), 'Ada is spelling the guess')
  assert.equal(stepLine({ turn: 'moon', step: { at: 'guess', holder: null } }, nameOf), 'Moon is guessing')
})

test('the game over line names a winner or says both teams lose', () => {
  const nameOf = () => '?'
  assert.equal(stepLine({ turn: 'sun', step: { at: 'over', winner: 'moon' } }, nameOf), 'Moon wins')
  assert.equal(stepLine({ turn: 'sun', step: { at: 'over', winner: null } }, nameOf), 'Both teams lose')
})

test('a draft keeps stroke then undo hidden until the server has processed both', () => {
  const on = (x: number) => ({ points: [[x, 0]] as [number, number][], author: 'me' })
  const server = { processed: 3, strokes: [on(0)] }
  const drawn = draftStroke(null, server, on(1), 0)
  assert.deepEqual(drawn.strokes, [on(0), on(1)])
  assert.equal(draftCanUndo(drawn, false), true, 'undo is allowed before the server confirms')
  const undone = draftUndo(drawn, server, 10)
  assert.deepEqual(undone.strokes, [on(0)])
  assert.equal(draftCanUndo(undone, true), false, 'one undo per stroke')

  // The server has processed the stroke but not the undo: its row shows the stroke, the draft still hides it.
  assert.equal(liveDraft(undone, 4, 20), undone)
  // Both processed: the server row is the truth again.
  assert.equal(liveDraft(undone, 5, 30), null)
  assert.equal(draftCanUndo(liveDraft(undone, 5, 30), false), false)
})

test('an undo of a confirmed stroke hides it until processed, and stale drafts expire', () => {
  const on = (x: number) => ({ points: [[x, 0]] as [number, number][], author: 'me' })
  const undone = draftUndo(null, { processed: 7, strokes: [on(0), on(1)] }, 0)
  assert.deepEqual(undone.strokes, [on(0)])
  assert.equal(liveDraft(undone, 7, 100), undone)
  assert.equal(liveDraft(undone, 7, DRAFT_MS), null, 'a server that never catches up stops being waited on')
})
