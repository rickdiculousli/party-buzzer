import test from 'node:test'
import assert from 'node:assert/strict'
import { BOW_FIELD, BOW_STEP_MS } from './types.ts'
import type { BowArrow, BowWorld, CreateBowWorld } from './types.ts'
import { segmentDistance } from './geometry.ts'
import { createBowWorld, releaseBow, setBowAim, stepBow, sampleBowTrajectory, bowResults } from './world.ts'

const world = () => createBowWorld({
  seed: 7,
  playerIds: ['ada'],
  targets: [{ id: 'far', center: { x: 1400, y: 100 }, radius: 40 }],
})
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9)

test('creation sorts and deduplicates players without mutating inputs', () => {
  const playerIds = ['zoe', 'ada', 'zoe', 'bo']
  const w = createBowWorld({ seed: 7, playerIds })
  assert.deepEqual(w, createBowWorld({ seed: 7, playerIds: ['bo', 'zoe', 'ada'] }))
  assert.deepEqual(playerIds, ['zoe', 'ada', 'zoe', 'bo'])
  assert.deepEqual(['ada', 'bo', 'zoe'].map(id => w.players[id].origin), [
    { x: 400, y: 850 }, { x: 800, y: 850 }, { x: 1200, y: 850 },
  ])
  assert.equal(w.tick, 0)
  assert.equal(w.nowMs, 0)
  assert.deepEqual(w.arrows, [])
  for (const p of Object.values(w.players)) {
    assert.deepEqual(p.aim, { angle: 0, tension: 0 })
    assert.equal(p.reloadUntilMs, 0)
    assert.equal(p.score, 0)
    assert.equal(p.shots, 0)
  }
  assert.deepEqual(createBowWorld({ seed: 0, playerIds: [], targets: [] }).targets, [])
})

test('seeded targets stay in five lanes, inside the field, above bows and apart', () => {
  for (let seed = 0; seed < 100; seed++) {
    const w = createBowWorld({ seed, playerIds: ['ada', 'bo'] })
    assert.equal(w.targets.length, 5)
    assert.equal(new Set(w.targets.map(t => t.id)).size, 5)
    w.targets.forEach((t, index) => {
      assert.ok(t.radius > 0)
      assert.ok(t.center.x - t.radius >= index * BOW_FIELD.width / 5)
      assert.ok(t.center.x + t.radius <= (index + 1) * BOW_FIELD.width / 5)
      assert.ok(t.center.y - t.radius >= 0)
      assert.ok(t.center.y + t.radius < 520)
      for (const other of w.targets.slice(index + 1)) {
        assert.ok(Math.hypot(t.center.x - other.center.x, t.center.y - other.center.y) > t.radius + other.radius)
      }
      for (const p of Object.values(w.players)) {
        assert.ok(Math.hypot(t.center.x - p.origin.x, t.center.y - p.origin.y) > t.radius)
      }
    })
  }
  const a = createBowWorld({ seed: 7, playerIds: ['ada'] })
  const b = createBowWorld({ seed: 8, playerIds: ['ada'] })
  assert.notDeepEqual(a.targets, b.targets)
  assert.deepEqual(a.players, b.players)
  assert.deepEqual(a.config, b.config)
})

test('world owns copies of targets and config', () => {
  const targets = [{ id: 't', center: { x: 200, y: 300 }, radius: 40 }]
  const config = { gravity: 0 }
  const w = createBowWorld({ seed: 1, playerIds: ['ada'], targets, config })
  w.targets[0].center.x = 500
  w.targets[0].radius = 20
  w.config.gravity = 10
  assert.deepEqual(targets, [{ id: 't', center: { x: 200, y: 300 }, radius: 40 }])
  assert.deepEqual(config, { gravity: 0 })
  assert.equal(world().config.gravity, 980)
})

test('aim clamps normalized values and unchanged or refused commands preserve the world', () => {
  const w = world()
  assert.deepEqual(setBowAim(w, 'ada', { angle: 2, tension: -1 }), { status: 'applied' })
  assert.deepEqual(w.players.ada.aim, { angle: 1, tension: 0 })
  const before = structuredClone(w)
  assert.deepEqual(setBowAim(w, 'ada', { angle: 3, tension: -2 }), { status: 'unchanged' })
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const aim of [{ angle: value, tension: 1 }, { angle: 0, tension: value }]) {
      assert.deepEqual(setBowAim(w, 'ada', aim), { status: 'refused', reason: 'invalid-aim' })
    }
  }
  for (const id of ['missing', 'toString', '__proto__']) {
    assert.deepEqual(setBowAim(w, id, { angle: 0, tension: 1 }), { status: 'refused', reason: 'unknown-player' })
    assert.deepEqual(releaseBow(w, id), { status: 'refused', reason: 'unknown-player' })
  }
  assert.deepEqual(w, before)
  assert.deepEqual(setBowAim(w, 'ada', { angle: -2, tension: 2 }), { status: 'applied' })
  assert.deepEqual(w.players.ada.aim, { angle: -1, tension: 1 })
})

test('release maps angle to 65 degrees from up and tension to configured speed', () => {
  for (const angle of [-1, 0, 1]) {
    for (const tension of [0, 0.5, 1]) {
      const w = createBowWorld({ seed: 1, playerIds: ['ada'], targets: [], config: { minSpeed: 600, maxSpeed: 1200 } })
      setBowAim(w, 'ada', { angle, tension })
      assert.deepEqual(releaseBow(w, 'ada'), { status: 'accepted', arrowId: 'arrow-0', reloadUntilMs: 700 })
      const arrow = w.arrows[0]
      near(Math.hypot(arrow.velocity.x, arrow.velocity.y), 600 + 600 * tension)
      near(Math.atan2(arrow.velocity.x, -arrow.velocity.y), angle * 65 * Math.PI / 180)
      near(arrow.angle, Math.atan2(arrow.velocity.y, arrow.velocity.x))
      assert.equal(arrow.position.x, w.players.ada.origin.x)
      assert.ok(arrow.position.y < w.players.ada.origin.y)
      assert.ok(arrow.position.y > w.players.ada.origin.y - 50)
      assert.deepEqual(arrow.previous, arrow.position)
      assert.notEqual(arrow.previous, arrow.position)
      assert.equal(arrow.playerId, 'ada')
      assert.equal(arrow.state, 'flying')
      assert.equal(arrow.bornAtMs, 0)
      assert.equal(arrow.tailKick, 0)
      assert.equal(w.players.ada.shots, 1)
      assert.equal(w.players.ada.score, 0)
    }
  }
})

test('reload refuses without mutation until the first legal tick, independently per player', () => {
  for (const reloadMs of [700, 705]) {
    const w = createBowWorld({ seed: 1, playerIds: ['ada', 'bo'], targets: [], config: { reloadMs } })
    releaseBow(w, 'ada')
    assert.equal(releaseBow(w, 'bo').status, 'accepted')
    const legalTick = Math.ceil(reloadMs / BOW_STEP_MS)
    for (let tick = 0; tick < legalTick; tick++) {
      const before = structuredClone(w)
      assert.deepEqual(releaseBow(w, 'ada'), { status: 'refused', reason: 'reloading' })
      assert.deepEqual(w, before)
      stepBow(w)
    }
    assert.equal(w.tick, legalTick)
    assert.deepEqual(releaseBow(w, 'ada'), {
      status: 'accepted', arrowId: 'arrow-2', reloadUntilMs: w.nowMs + reloadMs,
    })
    assert.equal(w.arrows[2].bornAtMs, w.nowMs)
    assert.equal(w.players.ada.shots, 2)
  }
})

test('capacity counts flying and lodged arrows and refusal does not consume a shot or id', () => {
  for (const state of ['flying', 'lodged-target', 'lodged-boundary'] as const) {
    const w = createBowWorld({ seed: 1, playerIds: ['ada'], targets: [], config: { entityCap: 1, reloadMs: 0 } })
    releaseBow(w, 'ada')
    w.arrows[0].state = state
    const before = structuredClone(w)
    assert.deepEqual(releaseBow(w, 'ada'), { status: 'refused', reason: 'capacity' })
    assert.deepEqual(w, before)
  }
  const w = createBowWorld({ seed: 1, playerIds: ['ada'], config: { entityCap: 0 } })
  const before = structuredClone(w)
  assert.deepEqual(releaseBow(w, 'ada'), { status: 'refused', reason: 'capacity' })
  assert.deepEqual(w, before)
})

test('fixed steps integrate gravity before position and preserve previous tip and lodged arrows', () => {
  // Keep the flight inside the field and the lodged fixture clear of its path.
  const w = createBowWorld({ seed: 7, playerIds: ['ada'], targets: [], config: { maxSpeed: 1000 } })
  setBowAim(w, 'ada', { angle: 0.5, tension: 1 })
  releaseBow(w, 'ada')
  const initial = structuredClone(w.arrows[0])
  const lodged = { ...structuredClone(initial), id: 'lodged', position: { x: 100, y: 100 }, state: 'lodged-target' as const }
  w.arrows.push(lodged)
  const lodgedBefore = structuredClone(lodged)
  const dt = BOW_STEP_MS / 1000
  for (let n = 1; n <= 60; n++) {
    const previous = { ...w.arrows[0].position }
    stepBow(w)
    const arrow = w.arrows[0]
    assert.deepEqual(arrow.previous, previous)
    assert.notEqual(arrow.previous, arrow.position)
    near(arrow.velocity.x, initial.velocity.x)
    near(arrow.velocity.y, initial.velocity.y + n * w.config.gravity * dt)
    near(arrow.position.x, initial.position.x + n * initial.velocity.x * dt)
    near(arrow.position.y, initial.position.y + n * initial.velocity.y * dt + w.config.gravity * dt * dt * n * (n + 1) / 2)
    near(arrow.angle, Math.atan2(arrow.velocity.y, arrow.velocity.x))
    assert.equal(w.nowMs, n * BOW_STEP_MS)
    assert.equal(w.tick, n)
  }
  assert.deepEqual(lodged, lodgedBefore)
})

test('empty worlds advance and zero gravity preserves velocity', () => {
  const w = createBowWorld({ seed: 1, playerIds: ['ada'], targets: [], config: { gravity: 0 } })
  stepBow(w)
  assert.equal(w.nowMs, BOW_STEP_MS)
  releaseBow(w, 'ada')
  const velocity = { ...w.arrows[0].velocity }
  stepBow(w)
  assert.deepEqual(w.arrows[0].velocity, velocity)
})

test('same seed and ordered commands replay identically', () => {
  const a = createBowWorld({ seed: 7, playerIds: ['ada', 'bo'] })
  const b = createBowWorld({ seed: 7, playerIds: ['bo', 'ada'] })
  for (let tick = 0; tick < 120; tick++) {
    for (const w of [a, b]) {
      setBowAim(w, 'ada', { angle: tick / 120, tension: 0.7 })
      releaseBow(w, 'ada')
      if (tick % 3 === 0) releaseBow(w, 'bo')
      stepBow(w)
    }
    assert.deepEqual(a, b)
  }
})

// Explicit tips and velocities isolate contacts from aim and layout generation.
function arrow(id: string, x: number, y: number, vx: number, vy: number): BowArrow {
  return {
    id, playerId: 'ada', position: { x, y }, previous: { x, y },
    velocity: { x: vx, y: vy }, angle: Math.atan2(vy, vx),
    bornAtMs: 0, state: 'flying', tailKick: 0,
  }
}
const empty = (config: CreateBowWorld['config'] = {}) =>
  createBowWorld({ seed: 1, playerIds: ['ada'], targets: [], config: { gravity: 0, ...config } })

test('target entry scores centerline bands, including their edges, only once', () => {
  for (const [offset, points] of [[0, 30], [28, 30], [28.01, 20], [62, 20], [62.01, 10], [100, 10]]) {
    const w = empty()
    w.targets = [{ id: 't', center: { x: 800, y: 300 }, radius: 100 }]
    w.arrows.push(arrow('a', 800 + offset, 420, 0, -18000))
    stepBow(w)
    const a = w.arrows[0]
    assert.equal(a.state, 'lodged-target')
    assert.equal(a.targetId, 't')
    near(Math.hypot(a.position.x - 800, a.position.y - 300), 100)
    assert.deepEqual(a.velocity, { x: 0, y: 0 })
    near(a.angle, -Math.PI / 2)
    assert.equal(a.lodgedAtMs, w.nowMs)
    assert.equal(w.players.ada.score, points)
    const lodged = structuredClone(a)
    stepBow(w)
    assert.equal(w.players.ada.score, points)
    assert.deepEqual(a, lodged)
  }
})

test('short target entry uses the infinite centerline, not distance to the step endpoint', () => {
  const w = empty()
  w.targets = [{ id: 't', center: { x: 800, y: 300 }, radius: 100 }]
  w.arrows.push(arrow('a', 800, 420, 0, -1800))
  stepBow(w)
  assert.deepEqual(w.arrows[0].position, { x: 800, y: 400 })
  assert.equal(w.players.ada.score, 30)
})

test('left, right, top and corner contacts clamp at the first boundary', () => {
  for (const [x, y, vx, vy, endX, endY] of [
    [10, 200, -1200, 0, 0, 200], [1590, 200, 1200, 0, 1600, 200],
    [800, 10, 0, -1200, 800, 0], [10, 20, -1200, -1200, 0, 10],
    [10, 10, -1200, -1200, 0, 0],
  ]) {
    const w = empty()
    w.arrows.push(arrow('a', x, y, vx, vy))
    const direction = w.arrows[0].angle
    stepBow(w)
    assert.equal(w.arrows[0].state, 'lodged-boundary')
    assert.deepEqual(w.arrows[0].position, { x: endX, y: endY })
    assert.deepEqual(w.arrows[0].velocity, { x: 0, y: 0 })
    assert.equal(w.arrows[0].angle, direction)
    assert.equal(w.players.ada.score, 0)
  }
})

test('bottom exits remove misses and earlier surfaces win regardless of target order', () => {
  const w = empty()
  w.arrows.push(arrow('miss', 800, 890, 0, 1200))
  stepBow(w)
  assert.equal(w.arrows.length, 0)
  w.targets = [
    { id: 'far', center: { x: 800, y: 200 }, radius: 20 },
    { id: 'near', center: { x: 800, y: 300 }, radius: 20 },
  ]
  w.arrows.push(arrow('hit', 800, 400, 0, -18000))
  stepBow(w)
  assert.equal(w.arrows[0].targetId, 'near')
  assert.deepEqual(w.arrows[0].position, { x: 800, y: 320 })
  const outside = empty()
  outside.targets = [{ id: 'outside', center: { x: -100, y: 300 }, radius: 20 }]
  outside.arrows.push(arrow('a', 10, 300, -18000, 0))
  stepBow(outside)
  assert.equal(outside.arrows[0].state, 'lodged-boundary')
  assert.equal(outside.players.ada.score, 0)
})

const tail = (a: BowArrow) => ({
  x: a.position.x - 48 * Math.cos(a.angle), y: a.position.y - 48 * Math.sin(a.angle),
})

test('a lodged shaft deflects a swept arrow, loses energy, and kicks without moving', () => {
  const w = empty()
  const fixed = { ...arrow('fixed', 800, 524, 0, 0), angle: Math.PI / 2,
    state: 'lodged-boundary' as const, lodgedAtMs: 0 }
  const flying = arrow('flying', 700, 500, 12000, 0)
  const before = structuredClone(fixed)
  w.arrows.push(flying, fixed)
  stepBow(w)
  assert.equal(flying.state, 'flying')
  assert.ok(flying.velocity.x < 0)
  near(Math.hypot(flying.velocity.x, flying.velocity.y), 9600)
  assert.ok(segmentDistance(flying.position, tail(flying), fixed.position, tail(fixed)) > 8)
  assert.ok(Math.abs(fixed.tailKick) > 0 && Math.abs(fixed.tailKick) <= 1)
  assert.deepEqual({ ...fixed, tailKick: 0 }, before)
  const kick = Math.abs(fixed.tailKick)
  stepBow(w)
  assert.ok(Math.abs(fixed.tailKick) < kick)
  assert.deepEqual({ ...fixed, tailKick: 0 }, before)
  assert.equal(w.players.ada.score, 0)
})

test('flying arrows exchange normal momentum at restitution 0.35 and keep tangent velocity', () => {
  const w = empty()
  const a = arrow('a', 700, 500, 12000, 120)
  const b = arrow('b', 800, 500, -12000, 120)
  w.arrows.push(a, b)
  stepBow(w)
  near(a.velocity.x, -4200)
  near(b.velocity.x, 4200)
  near(a.velocity.y, 120)
  near(b.velocity.y, 120)
  assert.equal(a.state, 'flying')
  assert.equal(b.state, 'flying')
  assert.ok(segmentDistance(a.position, tail(a), b.position, tail(b)) > 8)
  const velocities = [structuredClone(a.velocity), structuredClone(b.velocity)]
  stepBow(w)
  assert.deepEqual([a.velocity, b.velocity], velocities)
})

test('parallel near misses and separated moving-away arrows keep their velocity', () => {
  for (const [ay, by, av, bv] of [[500, 509, 12000, -12000], [500, 500, -600, 600]]) {
    const w = empty()
    const a = arrow('a', 700, ay, av, 0), b = arrow('b', 800, by, bv, 0)
    w.arrows.push(a, b)
    stepBow(w)
    assert.deepEqual(a.velocity, { x: av, y: 0 })
    assert.deepEqual(b.velocity, { x: bv, y: 0 })
  }
})

test('simultaneous collision pairs resolve identically in lexical id order', () => {
  const a = empty(), b = empty()
  a.arrows = [arrow('arrow-2', 800, 500, 0, 0), arrow('arrow-10', 652, 500, 12000, 0), arrow('arrow-1', 900, 500, -12000, 0)]
  b.arrows = structuredClone(a.arrows).reverse()
  stepBow(a); stepBow(b)
  assert.notEqual(a.arrows.find(a => a.id === 'arrow-10')?.velocity.x, 12000)
  for (let tick = 0; tick < 4; tick++) { stepBow(a); stepBow(b) }
  const sorted = (w: BowWorld) => [...w.arrows].sort((a, b) => a.id < b.id ? -1 : 1)
  assert.deepEqual(sorted(a), sorted(b))
  assert.notEqual(a.arrows.find(a => a.id === 'arrow-10')?.velocity.x, 12000)
})

test('arrow and surface contacts compete by time so a shield prevents a later score', () => {
  for (const [targetX, expectedScore] of [[850, 0], [680, 30]]) {
    const w = empty()
    w.targets = [{ id: 't', center: { x: targetX, y: 500 }, radius: 20 }]
    const fixed = { ...arrow('fixed', 750, 524, 0, 0), angle: Math.PI / 2,
      state: 'lodged-boundary' as const, lodgedAtMs: 0 }
    w.arrows = [fixed, arrow('flying', 600, 500, 18000, 0)]
    stepBow(w)
    assert.equal(w.players.ada.score, expectedScore)
    assert.equal(w.arrows[1].state, expectedScore ? 'lodged-target' : 'flying')
    assert.equal(fixed.tailKick === 0, expectedScore > 0)
  }
})

test('expiry removes arrows on their first lifetime tick before collisions and frees capacity', () => {
  const w = empty({ flyingLifetimeMs: 2 * BOW_STEP_MS, lodgedLifetimeMs: 2 * BOW_STEP_MS, entityCap: 2, reloadMs: 0 })
  const flying = arrow('flying', 100, 400, 0, 0)
  const lodged = { ...arrow('lodged', 800, 400, 0, 0), state: 'lodged-target' as const, lodgedAtMs: BOW_STEP_MS }
  w.arrows = [flying, lodged]
  stepBow(w)
  assert.equal(w.arrows.length, 2)
  assert.equal(releaseBow(w, 'ada').status, 'refused')
  stepBow(w)
  assert.deepEqual(w.arrows, [lodged])
  assert.equal(releaseBow(w, 'ada').status, 'accepted')
  stepBow(w)
  assert.equal(w.arrows.length, 1)
  assert.equal(w.arrows[0].id, 'arrow-0')
  const expired = empty({ flyingLifetimeMs: BOW_STEP_MS, lodgedLifetimeMs: BOW_STEP_MS })
  expired.targets = [{ id: 't', center: { x: 800, y: 300 }, radius: 100 }]
  expired.arrows = [arrow('old', 800, 420, 0, -1800),
    { ...arrow('legacy', 100, 100, 0, 0), state: 'lodged-boundary' }]
  stepBow(expired)
  assert.deepEqual(expired.arrows, [])
  assert.equal(expired.players.ada.score, 0)
})

test('lodged lifetime starts at lodging, not release', () => {
  const w = empty({ flyingLifetimeMs: 1000, lodgedLifetimeMs: 2 * BOW_STEP_MS })
  w.tick = 10
  w.nowMs = 10 * BOW_STEP_MS
  w.arrows = [arrow('a', 800, 10, 0, -1200)]
  stepBow(w)
  assert.equal(w.arrows[0].state, 'lodged-boundary')
  stepBow(w)
  assert.equal(w.arrows.length, 1)
  stepBow(w)
  assert.deepEqual(w.arrows, [])
})

test('trajectory previews match unobstructed flight with current aim and custom physics without mutation', () => {
  const w = empty({ gravity: 600, minSpeed: 500, maxSpeed: 900 })
  setBowAim(w, 'ada', { angle: 0.4, tension: 0.7 })
  const before = structuredClone(w)
  const samples = sampleBowTrajectory(w, 'ada', 100)
  assert.equal(samples.length, 24)
  assert.deepEqual(w, before)
  releaseBow(w, 'ada')
  for (const sample of samples) {
    stepBow(w)
    near(sample.x, w.arrows[0].position.x)
    near(sample.y, w.arrows[0].position.y)
  }
  samples[0].x = -1
  assert.ok(w.players.ada.origin.x > 0)
  assert.equal(sampleBowTrajectory(w, 'ada', 2.9).length, 2)
  for (const count of [0, -1, NaN, Infinity]) assert.deepEqual(sampleBowTrajectory(w, 'ada', count), [])
  assert.deepEqual(sampleBowTrajectory(w, 'unknown', 10), [])
  assert.deepEqual(sampleBowTrajectory(w, '__proto__', 10), [])
})

test('results include every player and sort by score, shots, then lexical id without mutation', () => {
  const w = createBowWorld({ seed: 3, playerIds: ['zoe', 'ada', 'bo', 'cy', 'idle'], targets: [] })
  Object.assign(w.players.zoe, { score: 20, shots: 3 })
  Object.assign(w.players.ada, { score: 20, shots: 2 })
  Object.assign(w.players.bo, { score: 20, shots: 2 })
  Object.assign(w.players.cy, { score: 30, shots: 5 })
  const before = structuredClone(w)
  const results = bowResults(w)
  assert.deepEqual(results, [
    { playerId: 'cy', points: 30, shots: 5 },
    { playerId: 'ada', points: 20, shots: 2 },
    { playerId: 'bo', points: 20, shots: 2 },
    { playerId: 'zoe', points: 20, shots: 3 },
    { playerId: 'idle', points: 0, shots: 0 },
  ])
  results[0].points = 0
  assert.deepEqual(w, before)
  assert.deepEqual(bowResults(createBowWorld({ seed: 0, playerIds: [] })), [])
})

test('collision separation near an edge cannot leave a flying tip outside the field', () => {
  const w = empty()
  w.arrows = [
    { ...arrow('fixed', 40, 524, 0, 0), angle: Math.PI / 2, state: 'lodged-boundary', lodgedAtMs: 0 },
    arrow('flying', 20, 500, 1200, 0),
  ]
  stepBow(w)
  const a = w.arrows[1]
  assert.equal(a.state, 'lodged-boundary')
  assert.equal(a.position.x, 0)
  assert.deepEqual(a.velocity, { x: 0, y: 0 })
})

for (const [name, x, radius, entryX] of [
  ['cannot skip a target', 765, 10, 775],
  ['stops at the target perimeter', 730, 40, 770],
] as const) {
  test(`collision separation ${name}`, () => {
    for (const reverse of [false, true]) {
      const w = empty()
      w.targets = [
        { id: 'earlier', center: { x, y: 500 }, radius },
        { id: 'later', center: { x: 720, y: 500 }, radius: 10 },
      ]
      const flying = arrow('flying', 780, 500, 1200, 0)
      w.arrows = [
        { ...arrow('fixed', 800, 524, 0, 0), angle: Math.PI / 2, state: 'lodged-boundary', lodgedAtMs: 0 },
        flying,
      ]
      if (reverse) { w.arrows.reverse(); w.targets.reverse() }
      stepBow(w)
      assert.equal(flying.state, 'lodged-target')
      assert.equal(flying.targetId, 'earlier')
      near(flying.position.x, entryX)
      near(flying.position.y, 500)
      assert.deepEqual(flying.velocity, { x: 0, y: 0 })
      assert.equal(w.players.ada.score, 30)
      stepBow(w)
      near(flying.position.x, entryX)
      assert.equal(w.players.ada.score, 30)
    }
  })
}

test('simultaneous contacts at the final instant of a tick all resolve in that tick', () => {
  const w = empty()
  w.arrows = [arrow('a', 20, 200, -1200, 0), arrow('b', 1580, 400, 1200, 0)]
  stepBow(w)
  assert.deepEqual(w.arrows.map(a => a.state), ['lodged-boundary', 'lodged-boundary'])
  assert.deepEqual(w.arrows.map(a => a.velocity), [{ x: 0, y: 0 }, { x: 0, y: 0 }])
})
