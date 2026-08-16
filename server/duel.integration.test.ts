import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { ARM_LEAD_MS } from './state.ts'
import { FakeClient, SETTLE, withServer } from './e2e.ts'

test('a duel: vote, seat, finalists only, exclusive rebound', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const ada = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    const cy = new FakeClient(url, 'player')
    await host.open()
    await ada.open('Ada')
    await bo.open('Bo')
    await cy.open('Cy')
    await bo.sync()

    host.send({ t: 'host', action: { a: 'openDuel', rule: 'vote' } })
    await sleep(60)
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    cy.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    bo.send({ t: 'act', act: 'duelVote', data: ada.playerId })
    await sleep(60)
    // The pool is room theater: phones see it too.
    const poolOnPhone = ada.last.duel?.pool ?? []
    assert.equal(poolOnPhone.find((e) => e.playerId === bo.playerId)?.votes.length, 2)

    host.send({ t: 'host', action: { a: 'closeDuel' } })
    await sleep(60)
    assert.deepEqual(host.last.duel?.seated, [bo.playerId, ada.playerId])

    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)
    assert.deepEqual(host.last.round.candidates, [bo.playerId, ada.playerId])

    // Cy is not in this round: the buzz is dropped, the window never opens.
    cy.send({ t: 'buzz', at: performance.now() })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'ARMED')

    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')
    host.send({ t: 'host', action: { a: 'wrong', neg: 0 } })
    await sleep(60)
    assert.deepEqual(host.last.round.candidates, [ada.playerId], 'the rebound is Ada’s alone')

    // Bo’s thumb is dead now; Ada’s is not.
    await sleep(ARM_LEAD_MS)
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(30)
    await ada.sync()
    ada.send({ t: 'buzz', at: performance.now() + ada.offset })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')
    assert.equal(host.last.round.order[0]?.playerId, ada.playerId)

    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[ada.playerId], host.last.round.value)

    host.send({ t: 'host', action: { a: 'next' } })
    await sleep(60)
    assert.equal(host.last.duel, undefined, 'the duel was one question')

    for (const c of [host, ada, bo, cy]) c.close()
  })
})
