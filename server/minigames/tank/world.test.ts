import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { COLS, ROWS } from './types.ts'
import { applyTankInput, createTankWorld, formCrews, gunDirection, stepTank, tankResults } from './world.ts'
import type { TankCrew } from '../../../shared/protocol.ts'

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not ${expected}`)

/** A world with no cover and every tank parked facing +x. */
function open(crews: TankCrew[], at = [{ x: 800, y: 450 }, { x: 1200, y: 450 }]) {
  const world = createTankWorld({ seed: 1, crews, cover: new Uint8Array(COLS * ROWS) })
  world.tanks.forEach((tank, index) => { tank.position = { ...at[index] }; tank.hull = 0; tank.turret = 0 })
  return world
}
const steps = (world: ReturnType<typeof open>, count: number) => { for (let i = 0; i < count; i++) stepTank(world) }
const DG: TankCrew = { id: 'crew-0', driver: 'd', gunner: 'g' }

test('crews pair every participant once, with one solo crew for an odd count', () => {
  const crews = formCrews(mulberry32(3), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(crews.length, 3)
  assert.equal(crews.filter((crew) => crew.driver === crew.gunner).length, 1)
  assert.deepEqual([...new Set(crews.flatMap((crew) => [crew.driver, crew.gunner]))].sort(), ['a', 'b', 'c', 'd', 'e'])
})

test('the gun turns with the hull, so the driver moves the gunner\'s aim', () => {
  const world = open([DG])
  const tank = world.tanks[0]
  assert.deepEqual(applyTankInput(world, 'g', { kind: 'wheel', turns: 0.5 }), { status: 'accepted' })
  close(tank.turret, Math.PI / 4)
  assert.equal(tank.hull, 0)
  applyTankInput(world, 'd', { kind: 'wheel', turns: 1 })
  close(tank.hull, Math.PI / 2)
  close(tank.turret, Math.PI / 4)
  close(gunDirection(tank), 3 * Math.PI / 4)
})

test('endless spinning keeps angles bounded', () => {
  const world = open([DG])
  for (let i = 0; i < 100; i++) applyTankInput(world, 'd', { kind: 'wheel', turns: 0.9 })
  assert.ok(Math.abs(world.tanks[0].hull) <= Math.PI)
})

test('a solo crew names which part its wheel turns', () => {
  const world = open([{ id: 'crew-0', driver: 's', gunner: 's' }])
  assert.deepEqual(applyTankInput(world, 's', { kind: 'wheel', turns: 1 }), { status: 'refused', reason: 'invalid' })
  applyTankInput(world, 's', { kind: 'wheel', turns: 1, part: 'turret' })
  close(world.tanks[0].turret, Math.PI / 2)
})

test('only the driver drives: 160 px/s forward, 100 px/s back', () => {
  const world = open([DG])
  assert.deepEqual(applyTankInput(world, 'g', { kind: 'drive', dir: 1 }), { status: 'refused', reason: 'invalid' })
  applyTankInput(world, 'd', { kind: 'drive', dir: 1 })
  steps(world, 60)
  close(world.tanks[0].position.x, 960, 1e-6)
  applyTankInput(world, 'd', { kind: 'drive', dir: -1 })
  steps(world, 60)
  close(world.tanks[0].position.x, 860, 1e-6)
})

test('cover and other tanks block movement', () => {
  const world = open([DG, { id: 'crew-1', driver: 'x', gunner: 'y' }], [{ x: 800, y: 450 }, { x: 800, y: 300 }])
  for (let row = 0; row < ROWS; row++) world.cover[row * COLS + 85] = 1 // wall at x 850..860
  applyTankInput(world, 'd', { kind: 'drive', dir: 1 })
  steps(world, 120)
  const tank = world.tanks[0]
  assert.ok(tank.position.x <= 828 && tank.position.x > 820, `stopped at ${tank.position.x}`)

  world.tanks[1].position = { x: 700, y: 300 }
  tank.position = { x: 600, y: 300 }
  steps(world, 120)
  assert.ok(Math.hypot(700 - tank.position.x, 0) >= 44 - 1e-9)
})

test('holding the gun fires 10 rounds a second, then reloads 2 s after the clip empties', () => {
  const world = open([DG])
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  steps(world, 60)
  assert.equal(world.tanks[0].shots, 10)
  steps(world, 174) // tick 234: the 20th round fired at tick 115
  assert.equal(world.tanks[0].shots, 20)
  assert.equal(world.tanks[0].gunClip, 0)
  steps(world, 1)
  assert.equal(world.tanks[0].shots, 21)
})

test('the cannon fires once per tap and refuses taps for 4 s', () => {
  const world = open([DG])
  const tap = { kind: 'trigger', weapon: 'cannon', down: true, at: 0 } as const
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', { ...tap, down: false }), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'refused', reason: 'reloading' })
  steps(world, 240)
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.equal(world.tanks[0].shots, 2)
})

const YZ: TankCrew = { id: 'crew-1', driver: 'y', gunner: 'z' }
const pullGun = (world: ReturnType<typeof open>) => {
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  stepTank(world)
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: false, at: 0 })
}
const cannon = (world: ReturnType<typeof open>) =>
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'cannon', down: true, at: 0 })

test('a gun round hits the first tank on its path for 5', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  pullGun(world)
  steps(world, 20)
  assert.equal(world.tanks[1].hp, 95)
  assert.equal(world.tanks[0].score, 5)
  assert.equal(world.projectiles.length, 0)
  assert.deepEqual(world.blasts.map((blast) => blast.weapon), ['gun'])
})

test('cover stops a shell, and the blast carves it', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  for (let row = 0; row < ROWS; row++) world.cover[row * COLS + 90] = 1 // x 900..910
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 100)
  assert.equal(world.cover[45 * COLS + 90], 0)
  assert.ok(world.coverChanged.includes(45 * COLS + 90))
  assert.deepEqual(world.blasts.map((blast) => blast.radius), [60])
})

test('a direct cannon hit does 30 with no extra splash', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 70)
  assert.equal(world.tanks[0].score, 30)
})

test('cannon splash falls off with distance', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 480 }])
  world.cover[45 * COLS + 100] = 1 // x 1000..1010, y 450..460: the shell bursts 8 px from the tank's edge
  cannon(world)
  steps(world, 30)
  assert.equal(world.tanks[1].hp, 83)
  assert.equal(world.tanks[0].score, 17)
})

test('splash hurts the firing tank and scores nothing', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1400, y: 800 }])
  world.cover[45 * COLS + 83] = 1 // right at the muzzle
  cannon(world)
  stepTank(world)
  assert.ok(world.tanks[0].hp < 100 && world.tanks[0].hp > 80, `hp ${world.tanks[0].hp}`)
  assert.equal(world.tanks[0].score, 0)
})

test('a kill scores 50; the tank respawns after 3 s far from enemies, briefly invulnerable', () => {
  const world = open([DG, YZ], [{ x: 800, y: 450 }, { x: 1000, y: 450 }])
  const target = world.tanks[1]
  target.hp = 5
  pullGun(world)
  while (target.deadUntilMs === null) stepTank(world)
  assert.equal(world.tanks[0].score, 55)
  steps(world, 179)
  assert.notEqual(target.deadUntilMs, null)
  stepTank(world)
  assert.equal(target.deadUntilMs, null)
  assert.equal(target.hp, 100)
  assert.deepEqual(target.position, { x: 100, y: 100 })
  close(target.invulnerableUntilMs, world.nowMs + 2_000, 1e-6)

  target.position = { x: 1000, y: 450 }
  pullGun(world)
  steps(world, 20)
  assert.equal(target.hp, 100, 'invulnerable tanks take no damage')
})

test('weapons fall silent at the match deadline while tanks can still move', () => {
  const world = createTankWorld({ seed: 1, crews: [DG], cover: new Uint8Array(COLS * ROWS), config: { ceaseFireMs: 50 } })
  applyTankInput(world, 'g', { kind: 'trigger', weapon: 'gun', down: true, at: 0 })
  steps(world, 10)
  assert.equal(world.tanks[0].shots, 1)
  assert.deepEqual(
    applyTankInput(world, 'g', { kind: 'trigger', weapon: 'cannon', down: true, at: 0 }),
    { status: 'refused', reason: 'not-playing' },
  )
})

test('results give each crew member the crew score, and a solo player once', () => {
  const world = open([DG, { id: 'crew-1', driver: 's', gunner: 's' }])
  world.tanks[0].score = 40
  world.tanks[1].score = 70
  assert.deepEqual(tankResults(world).map((result) => [result.playerId, result.points]), [
    ['s', 70], ['d', 40], ['g', 40],
  ])
})
