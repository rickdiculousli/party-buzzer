import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { FakeClient, withServer } from './e2e.ts'

test('host, player, and board share a live bow match over the existing socket', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const board = new FakeClient(url, 'board')
    const ada = new FakeClient(url, 'player')
    await host.open()
    await board.open()
    await ada.open('Ada')

    host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'bow', options: { durationSec: 5, seed: 7 } } })
    await sleep(40)
    assert.equal(host.last.minigame?.phase, 'ready')
    host.send({ t: 'host', action: { a: 'startMinigame' } })
    await sleep(3_100)
    assert.equal(host.last.minigame?.phase, 'playing')

    const matchId = host.last.minigame!.matchId
    ada.send({ t: 'minigameInput', matchId, seq: 1, input: { kind: 'aim', angle: 0, tension: 1 } })
    ada.send({ t: 'minigameInput', matchId, seq: 2, input: { kind: 'release', at: Date.now() } })
    await sleep(120)

    assert.equal(ada.minigameAcks.at(-1)?.ack.status, 'accepted')
    assert.equal(ada.minigameFrames.at(-1)?.frame.role, 'player')
    const frame = board.minigameFrames.at(-1)?.frame
    assert.equal(frame?.role, 'board')
    if (frame?.role === 'board' && frame.id === 'bow') assert.ok(frame.arrows.some((arrow) => arrow.playerId === ada.playerId))

    for (const client of [host, board, ada]) client.close()
  })
})
