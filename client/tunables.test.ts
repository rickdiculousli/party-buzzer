/**
 * The JavaScript's copy of a CSS tunable agrees with the stylesheet's.
 *
 * `TUNE` exists so a property the DOM cannot answer for still has a number, and
 * that number is only useful while it is the same number the room actually
 * sees. Nothing at runtime notices when it stops being: the fallback fires only
 * when the property is missing, so a rename or a build that eats a declaration
 * changes the tempo of a moment silently and correctly-in-dev. This is the
 * thing that notices.
 *
 * It reads the `anim:tunables` block specifically, not the whole file: a
 * tunable declared outside it is one the harness cannot write, which makes the
 * dial a lie whatever its value.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTune, TUNE } from './sound.ts'

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
    // Through the same parser the browser's value goes through, so a stylesheet
    // written in `s` and a fallback written in ms still compare equal.
    assert.equal(parseTune(m[1], NaN), fallback, `${name} disagrees with its fallback in sound.ts`)
  }
})
