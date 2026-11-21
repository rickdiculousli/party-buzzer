import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTune, TUNE } from './sound.ts'
import { FINALE_SCHEDULE } from '../shared/wall.ts'

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const start = css.indexOf('/* anim:tunables')
const end = css.indexOf('/* /anim:tunables */')
const block = css.slice(start, end)

test('the markers are still there', () => {
  assert.ok(start !== -1 && end > start, 'anim:tunables block missing from style.css')
})

test('every tunable the JS reads is declared in the block, at the same value', () => {
  for (const [name, fallback] of Object.entries(TUNE)) {
    const m = block.match(new RegExp(`${name}:\\s*([^;]+);`))
    assert.ok(m, `${name} is not declared in anim:tunables`)
    assert.equal(parseTune(m[1], NaN), fallback, `${name} disagrees with its fallback in sound.ts`)
  }
})

test('every --fx-* default the kit or its gallery reads is declared in the block', () => {
  const gallery = readFileSync(new URL('./anim/scenarios.tsx', import.meta.url), 'utf8')
  const OVERRIDES = new Set(['--fx-dur', '--fx-amp', '--fx-color', '--fx-from', '--fx-ease', '--fx-delay'])
  const used = new Set([...(css + gallery).matchAll(/--fx-[a-z-]+/g)].map((m) => m[0]))
  for (const name of used) {
    if (OVERRIDES.has(name)) continue
    assert.match(block, new RegExp(`^\\s*${name}:`, 'm'), `${name} is not declared in anim:tunables`)
  }
})

test('the finale schedule builds for exactly the flash animation', () => {
  const m = css.match(/\.board__finale-flash\s*\{[^}]*--finale-build-dur:\s*([^;]+);/)
  assert.ok(m, '--finale-build-dur is not declared on .board__finale-flash')
  assert.equal(parseTune(m[1], NaN), FINALE_SCHEDULE.build)
})
