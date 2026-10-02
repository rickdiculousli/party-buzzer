import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../../shared/random.ts'
import { pitch, type Frame } from '../../client/toss.ts'
import { violations } from './kinematics.ts'

const at = (t: number, x: number, rot = 0, lift = 0): Frame => ({ t, x, y: 0, rot, lift })

test('a real pitch raises no flags; a jump, a second push and spin from nowhere each do', () => {
  assert.deepEqual(violations(pitch({ x: 0, y: -100 }, { x: 0, y: 800, rot: 0 }, mulberry32(3))), [])
  const kinds = (frames: Frame[]) => violations(frames).map((v) => v.kind)
  assert.ok(kinds([at(0, 0), at(16, 10), at(32, 20), at(48, 200), at(64, 210)]).includes('jump'))
  assert.ok(kinds([at(0, 0), at(16, 30), at(32, 50), at(48, 60), at(64, 66), at(80, 80), at(96, 100)]).includes('re-accelerates'))
  assert.ok(kinds([at(0, 0, 0, 0.05), at(16, 20, 2, 0.05), at(32, 40, 8, 0.04), at(48, 60, 20, 0.03)]).includes('spins up in the air'))
})
