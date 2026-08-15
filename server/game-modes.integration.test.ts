import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { ARM_LEAD_MS } from './state.ts'
import { FakeClient, SETTLE, withServer } from './e2e.ts'

test('a quizbowl round: power bonus, fragments on the board but never on phones', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const board = new FakeClient(url, 'board')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await board.open()
    await amy.open('Amy')
    await amy.sync()

    host.send({
      t: 'host',
      action: {
        a: 'setGame',
        id: 'quizbowl',
        options: { powerAfterFragment: 2, powerBonus: 50, neg: 50 },
      },
    })
    await sleep(80)
    assert.equal(host.last.game.id, 'quizbowl')
    assert.equal(host.last.game.options.powerBonus, 50, 'options ride the state')
    assert.ok(host.last.games.some((g) => g.id === 'quizbowl'), 'the catalog rides too')

    host.send({ t: 'host', action: { a: 'setValue', value: 200 } })
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)

    host.send({ t: 'act', act: 'fragment', data: 'First fragment.' })
    await sleep(60)
    assert.deepEqual(board.last.round.fragments, ['First fragment.'])
    assert.equal(amy.last.round.fragments, undefined, 'phones never see the text early')

    // Amy presses during the power window; the reader's powerEnds lands after.
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await sleep(20)
    host.send({ t: 'act', act: 'powerEnds' })
    await sleep(SETTLE)
    assert.equal(host.last.round.phase, 'LOCKED')

    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[amy.playerId], 250, '200 + the 50 power bonus')
    assert.deepEqual(host.last.round.award, { name: 'Amy', points: 250 })

    host.send({ t: 'act', act: 'revealAnswer', data: 'The answer' })
    await sleep(60)
    assert.equal(board.last.round.answer, 'The answer')
    assert.equal(amy.last.round.answer, undefined)

    for (const c of [host, board, amy]) c.close()
  })
})

test('quizbowl wrong: configured neg, lockout, and an unpowered rebound', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    const bo = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')
    await bo.open('Bo')
    await amy.sync()
    await bo.sync()

    host.send({
      t: 'host',
      action: {
        a: 'setGame',
        id: 'quizbowl',
        options: { neg: 50, itemsEnabled: true },
      },
    })
    await sleep(60)

    host.send({ t: 'host', action: { a: 'setValue', value: 200 } })
    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(ARM_LEAD_MS + 30)

    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await sleep(20)
    host.send({ t: 'act', act: 'powerEnds' })
    await sleep(SETTLE)

    host.send({ t: 'host', action: { a: 'wrong', neg: 200 } })
    await sleep(80)
    assert.equal(host.last.scores[amy.playerId], -50, 'the module neg wins over the button')
    assert.deepEqual(host.last.round.lockedOut, [amy.playerId])
    assert.equal(host.last.round.phase, 'ARMED', 'rebound')

    // The rebound is the same question: power has ended, so Bo's buzz is not
    // powered even though it is first.
    await sleep(ARM_LEAD_MS + 20)
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await sleep(SETTLE)
    host.send({ t: 'host', action: { a: 'correct' } })
    await sleep(60)
    assert.equal(host.last.scores[bo.playerId], 200, 'no power on a rebound')
    // The grant machinery ran: someone holds an item now.
    assert.equal(Object.keys(host.last.items).length, 1)

    for (const c of [host, amy, bo]) c.close()
  })
})
