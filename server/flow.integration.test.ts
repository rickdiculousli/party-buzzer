import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { FakeClient, withServer } from './e2e.ts'
import type { FlowBlock } from '../shared/protocol.ts'

const blocks: FlowBlock[] = [
  { game: 'trivia', options: {}, count: 1, value: 200 },
  { game: 'quizbowl', options: {}, count: 1, duel: 'vote' },
]

test('a flow saves, loads, and walks the room from block to block', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const ada = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    await host.open()
    await ada.open('Ada')
    await bo.open('Bo')

    host.send({ t: 'host', action: { a: 'setFlow', blocks } })
    await sleep(60)
    host.send({ t: 'act', act: 'saveFlow', data: 'Test Night' })
    await sleep(60)
    assert.deepEqual(host.last.flows, ['test-night.json'])

    host.send({ t: 'host', action: { a: 'clearFlow' } })
    await sleep(60)
    assert.equal(host.last.flow, undefined)

    host.send({ t: 'act', act: 'loadFlow', data: 'test-night.json' })
    await sleep(60)
    const loaded = host.last
    assert.equal(loaded.flow?.blocks.length, 2)
    assert.equal(loaded.round.value, 200, 'block 1 set the value')

    // Play block 1's one question, and roll into the duel block.
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(60)
    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    const state = host.last
    assert.equal(state.flow?.at, 1)
    assert.equal(state.game.id, 'quizbowl')
    assert.equal(state.duel?.rule, 'vote')

    // The room can vote into the duel the flow opened — the seam holds end to end.
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    await sleep(60)
    assert.equal(host.last.duel?.pool[0]?.playerId, bo.playerId)
  })
})

test('a mid-flow undo restores the position and the mode together', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    await host.open()

    host.send({ t: 'host', action: { a: 'setFlow', blocks } })
    await sleep(60)
    assert.equal(host.last.flow?.at, 0)
    assert.equal(host.last.game.id, 'trivia')

    // Cross the block boundary: block 1 is one question long, so this one
    // `next` is both the mode switch and the position advance — one
    // synchronous mutation, which is the whole point of the undo test.
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(60)
    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    assert.equal(host.last.flow?.at, 1)
    assert.equal(host.last.game.id, 'quizbowl')

    host.send({ t: 'host', action: { a: 'undo' } })
    await sleep(60)
    assert.equal(host.last.flow?.at, 0, 'position rewound')
    assert.equal(host.last.game.id, 'trivia', 'mode rewound with it')
  })
})
