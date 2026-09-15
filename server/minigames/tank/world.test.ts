import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { COLS, ROWS } from './types.ts'
import { applyTankInput, createTankWorld, formCrews, gunDirection, stepTank } from './world.ts'
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

test('the cannon fires once per tap and refuses taps for 3 s', () => {
  const world = open([DG])
  const tap = { kind: 'trigger', weapon: 'cannon', down: true, at: 0 } as const
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', { ...tap, down: false }), { status: 'accepted' })
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'refused', reason: 'reloading' })
  steps(world, 180)
  assert.deepEqual(applyTankInput(world, 'g', tap), { status: 'accepted' })
  assert.equal(world.tanks[0].shots, 2)
})
