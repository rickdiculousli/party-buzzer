import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REVEAL_FIRST_CELLS, revealCells, revealShownAt } from './reveal.ts'

const r = { from: 1000, until: 11_000, live: true, sharp: false }

test('the mosaic steps on a fixed 250 ms clock, holds where a press held it, and is sharp once over', () => {
  assert.equal(revealShownAt(r, 1249), 1000)
  assert.equal(revealShownAt(r, 1250), 1250)
  assert.equal(revealShownAt({ ...r, live: false, heldAt: 3333 }, 9000), 3333)
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
  assert.ok(revealCells(r, 6000, full) < 40, 'still a guess at the midpoint')
})
