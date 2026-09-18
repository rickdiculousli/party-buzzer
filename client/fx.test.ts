import test from 'node:test'
import assert from 'node:assert/strict'
import { BURST_COUNT, countAt, glitchCut, graphemes, particles, words, type BurstKind } from './fx.ts'

/** A deterministic stand-in for Math.random. */
function seeded(seed = 1) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

const KINDS = Object.keys(BURST_COUNT) as BurstKind[]

test('graphemes keeps emoji and combining marks whole', () => {
  assert.deepEqual(graphemes('é👨‍👩‍👧!'), ['é', '👨‍👩‍👧', '!'])
})

test('words splits on runs of whitespace and drops the ends', () => {
  assert.deepEqual(words('  Ada  wins 🎉 '), [['A', 'd', 'a'], ['w', 'i', 'n', 's'], ['🎉']])
})

test('particles returns the requested count for every kind', () => {
  for (const kind of KINDS) assert.equal(particles(kind, 7, seeded()).length, 7, kind)
})

test('every particle ends within one amount of the centre', () => {
  for (const kind of KINDS)
    for (const p of particles(kind, 50, seeded(9)))
      assert.ok(Math.hypot(p.x, p.y) <= 1.0001, `${kind} flew to ${p.x},${p.y}`)
})

test('confetti is in the effect palette and flies upward', () => {
  for (const p of particles('confetti', 50, seeded(2))) {
    assert.match(p.color, /^var\(--fx-[1-8]\)$/)
    assert.ok(p.y < 0)
  }
})

test('embers rise and dust spreads sideways', () => {
  for (const p of particles('embers', 50, seeded(4))) assert.ok(p.y < 0)
  for (const p of particles('dust', 50, seeded(5))) assert.ok(Math.abs(p.y) < Math.abs(p.x))
})

test('emoji carries the glyph it was given', () => {
  for (const p of particles('emoji', 5, seeded(), '🦆')) assert.equal(p.glyph, '🦆')
})

test('the same seed gives the same burst', () => {
  assert.deepEqual(particles('stars', 5, seeded(3)), particles('stars', 5, seeded(3)))
})

test('countAt runs from `from` to `to` and never goes backwards', () => {
  assert.equal(countAt(0, 400, 0), 0)
  assert.equal(countAt(0, 400, 1), 400)
  assert.equal(countAt(0, 400, 2), 400)
  let last = -1
  for (let k = 0; k <= 1; k += 0.05) {
    const n = countAt(0, 400, k)
    assert.ok(n >= last)
    last = n
  }
})

test('glitchCut gives every layer two cuts that stay inside the box', () => {
  const cut = glitchCut(seeded(7))
  for (const layer of ['c', 'm', 'y'])
    for (const k of ['k1', 'k2']) {
      const m = cut[`--g${layer}-${k}`].match(/^inset\((\d+)% (\d+)% (\d+)% (\d+)%\)$/)
      assert.ok(m, `--g${layer}-${k} is ${cut[`--g${layer}-${k}`]}`)
      const [t, r, b, l] = m.slice(1).map(Number)
      assert.ok(t + b < 100 && l + r < 100, `--g${layer}-${k} leaves nothing to show`)
    }
})

test('glitchCut offsets stay within one amount and repeats are on or off', () => {
  const cut = glitchCut(seeded(8))
  for (const layer of ['c', 'm', 'y']) {
    for (const x of ['x1', 'x2']) assert.ok(Math.abs(Number(cut[`--g${layer}-${x}`])) <= 1)
    assert.match(cut[`--g${layer}-o2`], /^[01]$/)
    assert.match(cut[`--g${layer}-o3`], /^[01]$/)
  }
})

test('glitchCut tears a band that sits inside the text', () => {
  for (let s = 1; s < 30; s++) {
    const cut = glitchCut(seeded(s))
    const top = parseFloat(cut['--gt-top'])
    const bot = parseFloat(cut['--gt-bot'])
    assert.ok(top > 0 && bot > top && bot < 100, `band ${top}..${bot}`)
  }
})

test('glitchCut is deterministic under a seed', () => {
  assert.deepEqual(glitchCut(seeded(4)), glitchCut(seeded(4)))
})
