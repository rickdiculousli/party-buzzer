import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import type { SketchInput } from '../../../shared/protocol.ts'
import {
  CHOOSE_TICKS, REVEAL_TICKS, applySketch, createSketchWorld, drawerOf, sketchFinished, sketchResults, stepSketch,
  type SketchWorld,
} from './world.ts'

const WORDS = ['banana', 'cherry', 'dragon', 'eggplant', 'fennel', 'grapes', 'honeydew', 'kiwifruit', 'lemons', 'mango']
const SHORT = ['cat', 'dog', 'fox', 'owl', 'bee', 'ant', 'yak', 'emu', 'pig']

/** Three players, 10-second draws: 200 draw ticks, hints at 100 and 150. */
function world(over: Partial<Parameters<typeof createSketchWorld>[0]> = {}): SketchWorld {
  return createSketchWorld({ rand: mulberry32(1), words: WORDS, participants: ['a', 'b', 'c'], drawSec: 10, drawers: 0, ...over })
}

let at = 0
const act = (w: SketchWorld, player: string, input: Record<string, unknown>) =>
  applySketch(w, player, { at: ++at, ...input } as SketchInput)
const run = (w: SketchWorld, ticks: number) => { for (let i = 0; i < ticks; i++) stepSketch(w) }
const guessers = (w: SketchWorld) => w.participants.filter((id) => id !== drawerOf(w))
function drawing(over: Partial<Parameters<typeof createSketchWorld>[0]> = {}): SketchWorld {
  const w = world(over)
  assert.equal(act(w, drawerOf(w)!, { kind: 'pickWord', index: 1 }).status, 'accepted')
  return w
}

test('everyone draws once in a shuffled order, and Drawers limits the turns', () => {
  assert.deepEqual([...world().order].sort(), ['a', 'b', 'c'])
  assert.equal(world({ drawers: 2 }).order.length, 2)
  assert.equal(world({ drawers: 9 }).order.length, 3)
  const w = world()
  assert.equal(w.step, 'choosing')
  assert.equal(w.choices.length, 3)
})

test('a choose timeout takes the first word', () => {
  const w = world()
  const first = w.choices[0]
  run(w, CHOOSE_TICKS)
  assert.equal(w.step, 'drawing')
  assert.equal(w.word, first)
})

test('only the drawer picks, and the drawer cannot guess', () => {
  const w = world()
  assert.equal(act(w, guessers(w)[0], { kind: 'pickWord', index: 0 }).status, 'refused')
  assert.equal(act(w, drawerOf(w)!, { kind: 'pickWord', index: 5 }).status, 'refused')
  act(w, drawerOf(w)!, { kind: 'pickWord', index: 0 })
  assert.equal(act(w, drawerOf(w)!, { kind: 'guess', text: w.word }).status, 'refused')
})

test('a right guess scores more the sooner it lands, and cannot be sent twice', () => {
  const w = drawing()
  const [g1, g2] = guessers(w)
  act(w, g1, { kind: 'guess', text: w.word })
  assert.equal(w.scores[g1], 100)
  assert.equal(act(w, g1, { kind: 'guess', text: w.word }).status, 'refused')
  run(w, 100)
  act(w, g2, { kind: 'guess', text: w.word!.toUpperCase() })
  assert.equal(w.scores[g2], 75)
  assert.equal(w.step, 'reveal')
  assert.equal(w.end, 'all')
  assert.equal(w.scores[drawerOf(w)!], 100)
})

test('a close guess stays off the feed; wrong ones go on it and the feed keeps the latest eight', () => {
  const w = drawing()
  const [g1] = guessers(w)
  act(w, g1, { kind: 'guess', text: w.word!.slice(0, -1) })
  assert.equal(w.close[g1], 1)
  assert.equal(w.misses.length, 0)
  for (let i = 1; i <= 9; i++) act(w, g1, { kind: 'guess', text: `zzz${i}` })
  assert.equal(w.misses.length, 8)
  assert.equal(w.misses[0].text, 'zzz2')
  assert.ok(w.misses.every((miss, i) => i === 0 || miss.seq > w.misses[i - 1].seq))
})

test('strangers, empty and overlong guesses are refused', () => {
  const w = drawing()
  const [g1] = guessers(w)
  assert.equal(act(w, 'stranger', { kind: 'guess', text: w.word }).status, 'refused')
  assert.equal(act(w, g1, { kind: 'guess', text: '   ' }).status, 'refused')
  assert.equal(act(w, g1, { kind: 'guess', text: 'x'.repeat(41) }).status, 'refused')
  assert.equal(w.misses.length, 0)
  assert.equal(w.step, 'drawing')
})

test('the turn ends on timeout and on pass, the drawer is paid for guesses made, and late guesses are refused', () => {
  const timed = drawing()
  act(timed, guessers(timed)[0], { kind: 'guess', text: timed.word })
  run(timed, 200)
  assert.equal(timed.step, 'reveal')
  assert.equal(timed.end, 'timeup')
  assert.equal(timed.scores[drawerOf(timed)!], 50)
  assert.equal(act(timed, guessers(timed)[1], { kind: 'guess', text: timed.word }).status, 'refused')

  const passed = drawing()
  act(passed, guessers(passed)[0], { kind: 'guess', text: passed.word })
  assert.equal(act(passed, guessers(passed)[0], { kind: 'pass' }).status, 'refused')
  act(passed, drawerOf(passed)!, { kind: 'pass' })
  assert.equal(passed.end, 'pass')
  assert.equal(passed.scores[drawerOf(passed)!], 50)
})

test('hints reveal one letter at half time and another at three quarters, never on short words', () => {
  const w = drawing()
  run(w, 99)
  assert.equal(w.revealed.length, 0)
  run(w, 1)
  assert.equal(w.revealed.length, 1)
  run(w, 50)
  assert.equal(w.revealed.length, 2)

  const short = drawing({ words: SHORT })
  run(short, 199)
  assert.equal(short.revealed.length, 0)
})

test('strokes, undo and clear belong to the drawer and every one counts toward inkOps', () => {
  const w = drawing()
  const drawer = drawerOf(w)!
  const points = [[0.1, 0.1], [0.5, 0.5]]
  act(w, drawer, { kind: 'stroke', points })
  act(w, drawer, { kind: 'stroke', points })
  assert.equal(w.strokes.length, 2)
  assert.equal(act(w, guessers(w)[0], { kind: 'stroke', points }).status, 'refused')
  act(w, drawer, { kind: 'undo' })
  assert.equal(w.strokes.length, 1)
  act(w, drawer, { kind: 'clear' })
  assert.equal(w.strokes.length, 0)
  assert.equal(act(w, drawer, { kind: 'clear' }).status, 'refused')
  assert.equal(w.inkOps[drawer], 5)
})

test('the reveal hands over to the next drawer with fresh words, and the match ends after the last', () => {
  const w = drawing({ drawers: 2 })
  const firstDrawer = drawerOf(w)
  const firstChoices = [w.word]
  act(w, firstDrawer!, { kind: 'pass' })
  run(w, REVEAL_TICKS)
  assert.equal(w.turn, 1)
  assert.equal(w.step, 'choosing')
  assert.notEqual(drawerOf(w), firstDrawer)
  assert.equal(w.strokes.length, 0)
  assert.ok(w.choices.every((word) => !firstChoices.includes(word)))
  act(w, drawerOf(w)!, { kind: 'pickWord', index: 0 })
  act(w, drawerOf(w)!, { kind: 'pass' })
  assert.ok(!sketchFinished(w))
  run(w, REVEAL_TICKS)
  assert.ok(sketchFinished(w))
  const results = sketchResults(w)
  assert.equal(results.length, 3)
  assert.ok(results.every((r, i) => i === 0 || r.points <= results[i - 1].points))
})
