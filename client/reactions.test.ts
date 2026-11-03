import test from 'node:test'
import assert from 'node:assert/strict'
import { LIFTS, PILL_CAP, PILL_MS, recordReaction, shownPills, type TimedReaction } from './reactions.ts'

const receipt = (seq: number, playerId = 'ada', questionId = 'q1') =>
  ({ questionId, seq, playerId, kind: 'ooh' as const })

test('a pill lasts PILL_MS from receipt and only for its question', () => {
  const list = recordReaction([], receipt(1), 'q1', 1000)
  assert.deepEqual(shownPills(list, 'q1', 1000 + PILL_MS - 1).pills.map((p) => [p.seq, p.col, p.at]), [[1, 0, 1000]])
  assert.deepEqual(shownPills(list, 'q1', 1000 + PILL_MS), { pills: [], more: 0 })
  assert.deepEqual(shownPills(list, 'q2', 1000), { pills: [], more: 0 })
  assert.deepEqual(shownPills(list, undefined, 1000), { pills: [], more: 0 })
})

test('receipts for an old question are dropped, and recording sweeps the expired', () => {
  let list: TimedReaction[] = recordReaction([], receipt(1, 'ada', 'q0'), 'q1', 1000)
  assert.deepEqual(list, [], 'an old question never enters')
  assert.deepEqual(recordReaction(list, receipt(2), undefined, 1000), [], 'no question, nothing kept')
  list = recordReaction(list, receipt(2), 'q1', 1000)
  list = recordReaction(list, receipt(3, 'bo'), 'q1', 1000 + PILL_MS)
  assert.deepEqual(list.map((r) => [r.seq, r.col]), [[3, 0]], 'the expired one left when the next arrived, and its column with it')
})

test('past the cap a receipt only counts, for as long as a pill is up, and never takes a freed column', () => {
  let list: TimedReaction[] = []
  for (let seq = 1; seq <= 9; seq++) list = recordReaction(list, receipt(seq, `p${seq}`), 'q1', 1000 + seq * 10, 6)
  const shown = shownPills(list, 'q1', 1200)
  assert.deepEqual(shown.pills.map((p) => [p.seq, p.col]), [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5]])
  assert.equal(shown.more, 3)
  // The first three expire: the folded ones stay folded, so no pill is ever
  // mounted with less than its whole rise, hold and fade left.
  const later = shownPills(list, 'q1', 1030 + PILL_MS)
  assert.deepEqual(later.pills.map((p) => p.seq), [4, 5, 6])
  assert.equal(later.more, 3)
  // Once the last pill is gone the count goes too, whatever the folded ones' clocks say.
  assert.deepEqual(shownPills(list, 'q1', 1065 + PILL_MS), { pills: [], more: 0 })
  // A column freed by expiry goes to the next receipt to arrive, never one a
  // live pill still holds: the lowest free one, not the sequence number.
  list = recordReaction(list, receipt(10, 'p10'), 'q1', 1040 + PILL_MS, 6)
  assert.deepEqual(shownPills(list, 'q1', 1040 + PILL_MS).pills.map((p) => [p.seq, p.col]), [[5, 4], [6, 5], [10, 0]])
  assert.equal(PILL_CAP, 6, 'the default cap is 6')
  assert.equal(LIFTS.length, PILL_CAP, 'one lift per column')
  assert.equal(new Set(LIFTS).size, LIFTS.length, 'no two columns rest at one height')
})
