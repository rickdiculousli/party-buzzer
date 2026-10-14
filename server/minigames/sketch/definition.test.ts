import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { makeSketch } from './definition.ts'
import { STEP_MS, drawerOf, type SketchWorld } from './world.ts'

const WORDS = ['banana', 'cherry', 'dragon', 'eggplant', 'fennel', 'grapes', 'honeydew', 'kiwifruit', 'lemons']
const clock = (worldMs: number) => 1_000 + worldMs
const lobby = { teams: {}, volunteers: [], ready: [] }

function started() {
  const def = makeSketch(() => WORDS, mulberry32(1))
  assert.equal(def.prepare!(), null)
  const w = def.create(0, ['a', 'b', 'c'], { drawSec: 10, drawers: 0 }, lobby).world as SketchWorld
  return { def, w }
}

test('the word list and the room size gate the match', () => {
  assert.equal(makeSketch(() => null).prepare!(), 'sketch-words')
  assert.equal(makeSketch(() => ['one', 'two']).prepare!(), 'sketch-words')
  const def = makeSketch(() => WORDS)
  def.prepare!()
  assert.equal(def.startable!(lobby, ['a']), 'too-few-players')
  assert.equal(def.startable!(lobby, ['a', 'b', 'c']), null)
  assert.equal(def.startable!(lobby, ['a', 'b', 'c', 'd']), 'sketch-words')
})

test('a guesser sees the word only once they have it or at the reveal; the drawer sees it while drawing', () => {
  const { def, w } = started()
  const drawer = drawerOf(w)!
  const [g1, g2] = w.participants.filter((id) => id !== drawer)
  assert.equal((def.playerFrame(w, drawer, clock) as { choices: string[] }).choices.length, 3)
  assert.deepEqual((def.playerFrame(w, g1, clock) as { choices: string[] }).choices, [])
  def.apply(w, drawer, { kind: 'pickWord', index: 0, at: 1 })
  const word = w.word
  const wordOf = (id: string) => (def.playerFrame(w, id, clock) as { word: string | null }).word
  assert.equal(wordOf(drawer), word)
  assert.equal(wordOf(g1), null)
  assert.equal((def.boardFrame(w, clock) as { word: string | null }).word, null)
  def.apply(w, g1, { kind: 'guess', text: word, at: 2 })
  assert.equal(wordOf(g1), word)
  assert.equal(wordOf(g2), null)
  def.apply(w, drawer, { kind: 'pass', at: 3 })
  assert.equal(wordOf(g2), word)
  assert.equal((def.boardFrame(w, clock) as { word: string | null }).word, word)
  assert.equal(def.playerFrame(w, 'stranger', clock), null)
})

test('correct guesses are ordered by their own clamped timestamps', () => {
  const { def, w } = started()
  const drawer = drawerOf(w)!
  const [g1, g2] = w.participants.filter((id) => id !== drawer)
  def.apply(w, drawer, { kind: 'pickWord', index: 0, at: 1 })
  for (let i = 0; i < 100; i++) def.step(w)
  // Both land in the same step; g2's press was earlier.
  const start = clock(w.drawStart * STEP_MS)
  def.apply(w, g1, { kind: 'guess', text: w.word, at: start + 5_000 })
  def.apply(w, g2, { kind: 'guess', text: w.word, at: start + 4_900 })
  const frame = def.boardFrame(w, clock) as { correct: { player: string; ms: number }[] }
  assert.deepEqual(frame.correct.map((c) => c.player), [g2, g1])
  assert.equal(frame.correct[0].ms, 4_900)
})

test('strokes ride a frame when they change and once a second, and malformed input is dropped', () => {
  const { def, w } = started()
  const has = () => 'strokes' in (def.boardFrame(w, clock) as object)
  assert.ok(has())
  def.afterFrame!(w)
  assert.ok(!has())
  for (let i = 0; i < 20; i++) def.step(w)
  assert.ok(has())
  assert.equal(def.classify({ kind: 'guess', at: 1 }), null)
  assert.equal(def.classify({ kind: 'ink', points: [] }), null)
  assert.equal(def.classify({ kind: 'nope', at: 1 }), null)
  assert.equal(def.classify({ kind: 'guess', text: 'x', at: 1 }), 'discrete')
  assert.equal(def.classify({ kind: 'ink', points: [[0.5, 0.5]] }), 'continuous')
})
