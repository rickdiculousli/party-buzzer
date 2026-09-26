import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtSeconds, ordinal, sketchCues, type SketchView } from './sketch.ts'

const view = (over: Partial<SketchView> = {}): SketchView => ({
  matchId: 'm', tick: 10, serverTime: 10_000, step: 'drawing', drawer: 'd', turn: 0, turns: 3,
  blanks: '______', live: null, endsAt: 60_000, misses: [], correct: [], end: null, word: null, ...over,
})
const cues = (prev: SketchView | null, next: SketchView, who = 'board') => sketchCues(prev, next, who).map((c) => c.cue)

test('a first frame and a frame from another match play nothing', () => {
  assert.deepEqual(cues(null, view({ step: 'choosing', tick: 1 })), [])
  assert.deepEqual(cues(view({ matchId: 'old', step: 'choosing', tick: 0 }), view({ step: 'choosing', tick: 1 })), [])
})

test('a new turn calls the room on the board and only the drawer on phones', () => {
  const countdown = view({ step: 'choosing', tick: 0, blanks: '' })
  const started = view({ step: 'choosing', tick: 1, blanks: '' })
  assert.deepEqual(cues(countdown, started), ['sketch-turn'])
  assert.deepEqual(cues(countdown, started, 'd'), ['sketch-yours'])
  assert.deepEqual(cues(countdown, started, 'g'), [])
  const reveal = view({ step: 'reveal', end: 'timeup' })
  const next = view({ step: 'choosing', turn: 1, drawer: 'g', blanks: '' })
  assert.deepEqual(cues(reveal, next), ['sketch-turn'])
  assert.deepEqual(cues(reveal, next, 'g'), ['sketch-yours'])
})

test('the drawing starts on the board only', () => {
  const choosing = view({ step: 'choosing', blanks: '' })
  assert.deepEqual(cues(choosing, view()), ['sketch-go'])
  assert.deepEqual(cues(choosing, view(), 'd'), [])
})

test('a new wrong guess cues once, even when the feed is full and trimmed', () => {
  const full = Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, player: 'g', text: `w${i + 1}` }))
  const trimmed = [...full.slice(1), { seq: 9, player: 'g', text: 'w9' }]
  assert.deepEqual(cues(view({ misses: full }), view({ misses: trimmed })), ['sketch-miss'])
  assert.deepEqual(cues(view({ misses: full }), view({ misses: full })), [])
  assert.deepEqual(cues(view({ misses: full }), view({ misses: trimmed }), 'g'), [])
})

test('a right guess cues the board, the drawer and that guesser, rising with place', () => {
  const one = [{ seq: 3, player: 'g', ms: 1200 }]
  const two = [...one, { seq: 5, player: 'h', ms: 2400 }]
  assert.deepEqual(cues(view(), view({ correct: one })), ['sketch-got'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'd'), ['sketch-got'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'g'), ['sketch-right'])
  assert.deepEqual(cues(view(), view({ correct: one }), 'h'), [])
  const [first] = sketchCues(view(), view({ correct: one }), 'board')
  const [second] = sketchCues(view({ correct: one }), view({ correct: two }), 'board')
  assert.ok((second.rateScale ?? 1) > (first.rateScale ?? 1))
})

test('hints, the last five seconds, the way a turn ends, and the end of the match', () => {
  assert.deepEqual(cues(view({ blanks: '______' }), view({ blanks: 'b_____' })), ['sketch-hint'])
  assert.deepEqual(cues(view({ serverTime: 54_100 }), view({ serverTime: 55_100 })), ['sketch-tick'])
  assert.deepEqual(cues(view({ serverTime: 40_000 }), view({ serverTime: 41_000 })), [])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'all' })), ['sketch-all'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'timeup' })), ['sketch-timeup'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'pass' })), ['sketch-pass'])
  assert.deepEqual(cues(view({ step: 'reveal', end: 'pass' }), view({ step: 'over' })), ['sketch-over'])
  assert.deepEqual(cues(view(), view({ step: 'reveal', end: 'all' }), 'd'), [])
})

test('a close guess cues only the phone that made it', () => {
  assert.deepEqual(cues(view({ close: 0 }), view({ close: 1 }), 'g'), ['sketch-close'])
  assert.deepEqual(cues(view({ close: 1 }), view({ close: 1 }), 'g'), [])
})

test('places and times read the way the board shows them', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
  assert.equal(fmtSeconds(410), '+0.41s')
})
