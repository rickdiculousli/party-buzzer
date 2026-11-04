import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeClient, withServer } from './e2e.ts'

test('a duel: vote, seat, the seated only, exclusive rebound', async () => {
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

    await host.request({ t: 'host', action: { a: 'openDuel', rule: 'vote' } })
    ada.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    cy.send({ t: 'act', act: 'duelVote', data: bo.playerId })
    bo.send({ t: 'act', act: 'duelVote', data: ada.playerId })
    // The pool is room theater: phones see it too.
    await ada.until(
      (s) => (s.duel?.pool ?? []).reduce((n, e) => n + e.votes.length, 0) === 3,
      'all three votes on Ada’s phone',
    )
    const poolOnPhone = ada.last.duel?.pool ?? []
    assert.equal(poolOnPhone.find((e) => e.playerId === bo.playerId)?.votes.length, 2)

    await host.request({ t: 'host', action: { a: 'closeDuel' } })
    assert.deepEqual(host.last.duel?.seated, [bo.playerId, ada.playerId])

    await host.request({ t: 'host', action: { a: 'arm' } })
    assert.deepEqual(host.last.round.buzzable, [bo.playerId, ada.playerId])
    await host.untilOpen()

    // Cy is not in this round: the buzz is dropped, the window never opens.
    // Had it opened one, Bo's buzz would share it and Cy would lead the order.
    cy.send({ t: 'buzz', at: performance.now() })
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await host.until((s) => s.round.phase === 'LOCKED', 'Bo’s buzz to lock the round')
    assert.deepEqual(host.last.round.order.map((b) => b.playerId), [bo.playerId], 'Cy never joined')
    await host.request({ t: 'host', action: { a: 'wrong', neg: 0 } })
    assert.deepEqual(host.last.round.buzzable, [ada.playerId], 'the rebound is Ada’s alone')

    // Bo’s thumb is dead now; Ada’s is not.
    await host.untilOpen()
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await ada.sync()
    ada.send({ t: 'buzz', at: performance.now() + ada.offset })
    await host.until((s) => s.round.phase === 'LOCKED', 'Ada’s buzz to lock the rebound')
    assert.equal(host.last.round.order[0]?.playerId, ada.playerId)

    await host.request({ t: 'host', action: { a: 'correct' } })
    assert.equal(host.last.scores[ada.playerId], host.last.round.value)

    await host.request({ t: 'host', action: { a: 'next' } })
    assert.equal(host.last.duel, undefined, 'the duel was one question')

    for (const c of [host, ada, bo, cy]) c.close()
  })
})
