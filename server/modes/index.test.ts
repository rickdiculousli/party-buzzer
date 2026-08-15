import test from 'node:test'
import assert from 'node:assert/strict'
import { catalog, knownModule, moduleFor, sanitizeOptions } from './index.ts'
import type { OptionSpec } from '../../shared/protocol.ts'

test('unknown module ids fall back to trivia, and knownModule says so', () => {
  assert.equal(moduleFor('nope').id, 'trivia')
  assert.equal(knownModule('nope'), false)
  assert.equal(knownModule('trivia'), true)
})

test('catalog lists the registered modules with their option specs', () => {
  const games = catalog()
  assert.ok(games.some((g) => g.id === 'trivia'))
  assert.deepEqual(games.find((g) => g.id === 'trivia')?.options, [])
})

const SPECS: OptionSpec[] = [
  { kind: 'int', key: 'n', label: 'N', default: 5, min: 0, max: 10 },
  { kind: 'bool', key: 'b', label: 'B', default: true },
  { kind: 'choice', key: 'c', label: 'C', default: 'x', choices: ['x', 'y'] },
]

test('sanitizeOptions fills defaults and coerces junk into range', () => {
  assert.deepEqual(sanitizeOptions(SPECS, {}), { n: 5, b: true, c: 'x' })
  assert.deepEqual(sanitizeOptions(SPECS, { n: 99, b: 'yes', c: 'z' }), {
    n: 10,
    b: true,
    c: 'x',
  })
  assert.deepEqual(sanitizeOptions(SPECS, { n: -4, b: false, c: 'y' }), {
    n: 0,
    b: false,
    c: 'y',
  })
  assert.deepEqual(sanitizeOptions(SPECS, { n: 3.7 }), { n: 4, b: true, c: 'x' })
})
