import test from 'node:test'
import assert from 'node:assert/strict'
import { BOW_FIELD, BOW_STEP_MS } from './types.ts'
import { createBowWorld, releaseBow, setBowAim, stepBow } from './world.ts'

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
  const w = world()
  setBowAim(w, 'ada', { angle: 0.5, tension: 1 })
  releaseBow(w, 'ada')
  const initial = structuredClone(w.arrows[0])
  const lodged = { ...structuredClone(initial), id: 'lodged', state: 'lodged-target' as const }
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
