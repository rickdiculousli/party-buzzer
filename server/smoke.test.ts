import test from 'node:test'
import assert from 'node:assert/strict'
import { PORT } from './index.ts'

test('runs typescript natively and reads the port', () => {
  const n: number = PORT
  assert.equal(n, 8080)
})
