import test from 'node:test'
import assert from 'node:assert/strict'
import { whenever, neverFollows, phaseGraph, minGap, check, type Rule } from './rules.ts'
import type { Frame } from '../server/trace.ts'

const frame = (seq: number, cause: string, phase: string, order: unknown[] = [], scores = {}): Frame =>
  ({ seq, t: 1000 + seq * 100, cause, state: { round: { phase, armedAt: 900, order }, players: [], scores, game: { id: 'trivia' } } }) as never

test('whenever flags a frame where must fails', () => {
  const rule = whenever('lock needs a leader',
    (_prev, f) => f.state.round.phase === 'LOCKED',
    (_prev, f) => f.state.round.order.length > 0)
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED', [{ playerId: 'a' }])]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(bad, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].rule, 'lock needs a leader')
  assert.equal(v[0].seq, 1)
})

test('neverFollows flags an adjacent moment pair', () => {
  // buzz:open immediately followed by idle:ready is a legal-shape pair for
  // the factory test — the real moment pairs live in the RULES table.
  const rule = neverFollows('no ready after open', 'buzz:open', 'idle:ready')
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'host:resetRound', 'IDLE'),
  ]
  // ARMED with armedAt in the past is buzz:open; IDLE with armedAt set is idle:ready.
  const v = check(frames, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].seq, 1)
})

test('phaseGraph flags an illegal transition and allows legal ones', () => {
  const rule = phaseGraph('phases', {
    IDLE: ['ARMED'], ARMED: ['COLLECTING', 'IDLE'], COLLECTING: ['LOCKED', 'IDLE'], LOCKED: ['IDLE'],
  })
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'buzz', 'COLLECTING'), frame(2, 'settle', 'LOCKED'), frame(3, 'host:next', 'IDLE')]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  assert.equal(check(bad, [rule], {}).length, 1)
})

test('minGap flags a settle that lands early', () => {
  const rule = minGap('full collect window', 'buzz', 'settle', 1000)
  const ok = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 2500 }]
  const early = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 1500 }]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(early, [rule], {})
  assert.equal(v.length, 1)
  assert.match(v[0].detail, /500/)
})

test('check runs every rule and returns every violation', () => {
  const rules: Rule[] = [
    whenever('a', () => true, () => false),
    whenever('b', () => true, () => false),
  ]
  const v = check([frame(0, 'x', 'IDLE'), frame(1, 'y', 'IDLE')], rules, {})
  assert.equal(v.length, 4)
})

import { cueWindows, noOverlap, type Window } from './rules.ts'
import { RECIPES, span } from '../client/cues.ts'
import { TUNE } from '../client/sound.ts'

test('cueWindows: order growth is leader then stamps, one window per new entry', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]),
    frame(2, 'buzz', 'COLLECTING', [{ playerId: 'a' }, { playerId: 'b' }]),
    frame(3, 'settle', 'LOCKED', [{ playerId: 'a' }, { playerId: 'b' }]),
  ]
  const w = cueWindows(frames)
  assert.equal(w.length, 2)
  assert.deepEqual(w[0], { kind: 'cue', cue: 'leader', start: frames[1].t, end: frames[1].t + span(RECIPES.leader!) })
  assert.deepEqual(w[1], { kind: 'cue', cue: 'stamp', start: frames[2].t, end: frames[2].t + span(RECIPES.stamp!) })
  // markGap spaces marks within one render's batch; each frame here is its own
  // broadcast, so the stagger never appears between frames — pin the constant.
  assert.equal(TUNE['--mark-stagger'], 100)
})

test('cueWindows: an award appearing fires award or penalty', () => {
  const withAward = (seq: number, points: number): Frame => {
    const base = frame(seq, 'host:correct', 'LOCKED', [{ playerId: 'a' }])
    return { ...base, state: { ...base.state, round: { ...base.state.round, award: { name: 'Ada', points } } } } as never
  }
  const frames = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a' }]), withAward(1, 200), withAward(2, -50)]
  const w = cueWindows(frames).filter((x) => x.cue !== 'leader')
  assert.deepEqual(w.map((x) => x.cue), ['award', 'penalty'])
})

test('noOverlap flags intersecting windows of the two kinds', () => {
  const rule = noOverlap('voice over room', 'say', 'cue')
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]), // leader cue at t=1100
  ]
  const overlapping: Window[] = [{ kind: 'say', start: 1000, end: 1200 }]
  const clear: Window[] = [{ kind: 'say', start: 0, end: 900 }]
  assert.deepEqual(check(frames, [rule], { speech: clear }), [])
  assert.equal(check(frames, [rule], { speech: overlapping }).length, 1)
})

import { RULES } from './rules.ts'

const ruleNamed = (name: string): Rule => {
  const r = RULES.find((x) => x.name === name)
  assert.ok(r, `RULES is missing "${name}"`)
  return r
}

test('RULES: lock needs a leader fires on an empty LOCKED', () => {
  const v = check([frame(0, 'settle', 'LOCKED')], [ruleNamed('lock needs a leader')], {})
  assert.equal(v.length, 1)
})

test('RULES: scores move only on verdicts', () => {
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'buzz', 'COLLECTING', [], { ada: 400 })]
  const okUndo = [frame(0, 'host:correct', 'LOCKED'), frame(1, 'host:undo', 'IDLE', [], { ada: 0 })]
  assert.equal(check(bad, [ruleNamed('scores move only on verdicts')], {}).length, 1)
  assert.deepEqual(check(okUndo, [ruleNamed('scores move only on verdicts')], {}), [])
})

test('RULES: order is ordered allows ties, flags inversions', () => {
  const tied = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a', deltaMs: 0 }, { playerId: 'b', deltaMs: 0 }])]
  const inverted = [frame(0, 'settle', 'LOCKED', [{ playerId: 'a', deltaMs: 5 }, { playerId: 'b', deltaMs: 2 }])]
  assert.deepEqual(check(tied, [ruleNamed('order is ordered')], {}), [])
  assert.equal(check(inverted, [ruleNamed('order is ordered')], {}).length, 1)
})

test('RULES: voice ends at the buzz — a say window outliving it fires', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'a' }]), // t = 1100
  ]
  const speech = [{ kind: 'say', start: 500, end: 1300 }]
  assert.equal(check(frames, [ruleNamed('voice ends at the buzz')], { speech }).length, 1)
  assert.deepEqual(check(frames, [ruleNamed('voice ends at the buzz')], { speech: [{ kind: 'say', start: 500, end: 1100 }] }), [])
})
