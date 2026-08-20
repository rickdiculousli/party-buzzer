import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { FakeClient, withServer } from './e2e.ts'
import type { SetlistBlock } from '../shared/protocol.ts'

const blocks: SetlistBlock[] = [
  { game: 'trivia', options: {}, count: 1, value: 200 },
  { game: 'quizbowl', options: {}, count: 1, duel: 'vote' },
]

test('a setlist saves, loads, and walks the room from block to block', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const ada = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    await host.open()
    await ada.open('Ada')
    await bo.open('Bo')

    host.send({ t: 'host', action: { a: 'setSetlist', blocks } })
    await sleep(60)
    host.send({ t: 'act', act: 'saveSetlist', data: 'Test Night' })
    await sleep(60)
    assert.deepEqual(host.last.setlists, ['test-night.json'])

    host.send({ t: 'host', action: { a: 'clearSetlist' } })
    await sleep(60)
    assert.equal(host.last.setlist, undefined)

    host.send({ t: 'act', act: 'loadSetlist', data: 'test-night.json' })
    await sleep(60)
    const loaded = host.last
    assert.equal(loaded.setlist?.blocks.length, 2)
    assert.equal(loaded.round.value, 200, 'block 1 set the value')

    // Play block 1's one question, and roll into the duel block.
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(60)
    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    const state = host.last
    assert.equal(state.setlist?.at, 1)
    assert.equal(state.game.id, 'quizbowl')
    assert.equal(state.duel?.rule, 'vote')

    // The room can vote into the duel the setlist opened — the seam holds end to end.
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    await sleep(60)
    assert.equal(host.last.duel?.pool[0]?.playerId, bo.playerId)
  })
})

test('a mid-setlist undo restores the position and the mode together', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    await host.open()

    host.send({ t: 'host', action: { a: 'setSetlist', blocks } })
    await sleep(60)
    assert.equal(host.last.setlist?.at, 0)
    assert.equal(host.last.game.id, 'trivia')

    // Cross the block boundary: block 1 is one question long, so this one
    // `next` is both the mode switch and the position advance — one
    // synchronous mutation, which is the whole point of the undo test.
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(60)
    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    assert.equal(host.last.setlist?.at, 1)
    assert.equal(host.last.game.id, 'quizbowl')

    host.send({ t: 'host', action: { a: 'undo' } })
    await sleep(60)
    assert.equal(host.last.setlist?.at, 0, 'position rewound')
    assert.equal(host.last.game.id, 'trivia', 'mode rewound with it')
  })
})
