import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REVEAL_FIRST_CELLS, nextRevealStep, revealCells, revealShownAt } from './reveal.ts'

const r = { from: 1000, until: 11_000, live: true, sharp: false, opensAt: 1000 }

test('the mosaic steps on a fixed 250 ms clock, holds where a press held it, and is sharp once over', () => {
  assert.equal(revealShownAt(r, 1249), 1000)
  assert.equal(revealShownAt(r, 1250), 1250)
  assert.equal(revealShownAt({ ...r, live: false, heldAt: 3333 }, 9000), 3250, 'a hold lands on the step its press was in')
  assert.equal(revealShownAt({ ...r, from: -2000, until: 8000, opensAt: 1000 }, 700), 1000, 'a rebound holds where it stopped until the buzzers open')
  assert.equal(nextRevealStep(r, 1249), 1250)
  assert.equal(nextRevealStep(r, 1250), 1500, 'a timer aims at the boundary after this one')
  assert.equal(revealShownAt({ ...r, live: false }, 9000), undefined, 'a press not yet published keeps what is up')
  assert.equal(revealShownAt({ ...r, live: false, sharp: true, heldAt: 3333 }, 9000), 11_000)
})

test('cells start at six across, never coarsen as the clock runs, and end at full resolution', () => {
  const full = 1600
  assert.equal(revealCells(r, 1000, full), REVEAL_FIRST_CELLS)
  assert.equal(revealCells(r, 0, full), REVEAL_FIRST_CELLS, 'before the reveal starts')
  let last = 0
  for (let at = 1000; at <= 11_000; at += 250) {
    const cells = revealCells(r, at, full)
    assert.ok(cells >= last, `${at}: ${cells} after ${last}`)
    last = cells
  }
  assert.equal(last, full)
  assert.ok(revealCells(r, 6000, full) < 25, 'still a guess at the midpoint')
  for (let at = 1000; at < 3500; at += 250) assert.ok(revealCells(r, at + 250, full) > revealCells(r, at, full), `${at}: every step changes the grid`)
  assert.ok(revealCells(r, 10_750, full) < 120, 'not sharp until the plain value: the last quarter still sharpens')
})
