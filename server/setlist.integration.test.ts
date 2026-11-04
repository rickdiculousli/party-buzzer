import test from 'node:test'
import assert from 'node:assert/strict'
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

    await host.request({ t: 'host', action: { a: 'setSetlist', blocks } })
    host.send({ t: 'act', act: 'saveSetlist', data: 'Test Night' })
    await host.until((s) => s.setlists.length > 0, 'the saved setlist listed')
    assert.deepEqual(host.last.setlists, ['test-night.json'])

    await host.request({ t: 'host', action: { a: 'clearSetlist' } })
    assert.equal(host.last.setlist, undefined)

    await host.request({ t: 'act', act: 'loadSetlist', data: 'test-night.json' })
    const loaded = host.last
    assert.equal(loaded.setlist?.blocks.length, 2)
    assert.equal(loaded.round.value, 200, 'block 1 set the value')
    assert.equal(loaded.arrival?.kind, 'introduction', 'a loaded setlist opens on its first block')
    await host.request({ t: 'host', action: { a: 'closeArrival', arrivalId: loaded.arrival!.id } })

    // Play block 1's one question, and roll into the duel block.
    await host.request({ t: 'host', action: { a: 'arm' } })
    await host.request({ t: 'host', action: { a: 'next' } })
    const state = host.last
    assert.equal(state.setlist?.at, 1)
    assert.equal(state.game.id, 'quizbowl')
    assert.equal(state.duel?.rule, 'vote')

    // The room can vote into the duel the setlist opened — the seam holds end to end.
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    await host.until((s) => !!s.duel?.pool.some((e) => e.votes.length > 0), 'Ada’s vote counted')
    assert.equal(host.last.duel?.pool[0]?.playerId, bo.playerId)
  })
})

test('a mid-setlist undo restores the position and the mode together', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    await host.open()

    await host.request({ t: 'host', action: { a: 'setSetlist', blocks } })
    assert.equal(host.last.setlist?.at, 0)
    assert.equal(host.last.game.id, 'trivia')
    await host.request({ t: 'host', action: { a: 'closeArrival', arrivalId: host.last.arrival!.id } })

    // Cross the block boundary: block 1 is one question long, so this one
    // `next` is both the mode switch and the position advance — one
    // synchronous mutation, which is the whole point of the undo test.
    await host.request({ t: 'host', action: { a: 'arm' } })
    await host.request({ t: 'host', action: { a: 'next' } })
    assert.equal(host.last.setlist?.at, 1)
    assert.equal(host.last.game.id, 'quizbowl')

    await host.request({ t: 'host', action: { a: 'undo' } })
    assert.equal(host.last.setlist?.at, 0, 'position rewound')
    assert.equal(host.last.game.id, 'trivia', 'mode rewound with it')
  })
})

test('a setlist cannot be loaded mid-round, and the refusal costs no undo step', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    await host.open()

    await host.request({ t: 'host', action: { a: 'setSetlist', blocks } })
    host.send({ t: 'act', act: 'saveSetlist', data: 'Test Night' })
    await host.until((s) => s.setlists.length > 0, 'the saved setlist listed')
    await host.request({ t: 'host', action: { a: 'clearSetlist' } })
    assert.equal(host.last.setlist, undefined)

    // `loadSetlist` rides the act channel and so needs the guard its own
    // `setSetlist` carries. Without it the file is read and an undo snapshot
    // pushed before the mutation is declined, leaving a phantom step that eats
    // the arm — which is the assertion below, not the refusal above it.
    await host.request({ t: 'host', action: { a: 'arm' } })
    assert.notEqual(host.last.round.phase, 'IDLE')
    await host.request({ t: 'act', act: 'loadSetlist', data: 'test-night.json' })
    const during = host.last
    assert.equal(during.setlist, undefined, 'refused mid-round')

    // One undo, one step back: to before the arm, not to before a load that
    // never happened.
    await host.request({ t: 'host', action: { a: 'undo' } })
    assert.equal(host.last.round.phase, 'IDLE', 'the undo spent itself on the arm')

    // And it lands the moment the round is quiet again.
    await host.request({ t: 'act', act: 'loadSetlist', data: 'test-night.json' })
    const after = host.last
    assert.equal(after.setlist?.blocks.length, 2, 'accepted once idle')
  })
})
