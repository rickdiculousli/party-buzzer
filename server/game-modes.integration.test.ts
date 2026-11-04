import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeClient, withServer } from './e2e.ts'

test('a quizbowl round: power bonus, fragments on the board but never on phones', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const board = new FakeClient(url, 'board')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await board.open()
    await amy.open('Amy')
    await amy.sync()

    await host.request({
      t: 'host',
      action: {
        a: 'setMode',
        id: 'quizbowl',
        options: { powerAfterFragment: 2, powerBonus: 50, neg: 50 },
      },
    })
    assert.equal(host.last.game.id, 'quizbowl')
    assert.equal(host.last.game.options.powerBonus, 50, 'options ride the state')
    assert.ok(host.last.games.some((g) => g.id === 'quizbowl'), 'the catalog rides too')
    assert.deepEqual(host.last.game.status, { label: 'Power open', tone: 'active' })
    await board.until((s) => s.game.id === 'quizbowl', 'quizbowl on the board')
    await amy.until((s) => s.game.id === 'quizbowl', 'quizbowl on Amy’s phone')
    assert.equal(board.last.game.status, undefined, 'mode status is host-only')
    assert.equal(amy.last.game.status, undefined)

    await host.request({ t: 'host', action: { a: 'setValue', value: 200 } })
    await host.request({ t: 'host', action: { a: 'arm' } })
    await host.untilOpen()

    host.send({ t: 'act', act: 'fragment', data: 'First fragment.' })
    await board.until((s) => !!s.round.fragments?.length, 'the fragment on the board')
    assert.deepEqual(board.last.round.fragments, ['First fragment.'])
    // The board has it, so the same broadcast went to Amy before her next pong.
    await amy.flush()
    assert.equal(amy.last.round.fragments, undefined, 'phones never see the text early')

    // Amy presses during the power window; a manual power signal lands after.
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await host.until((s) => s.round.phase === 'COLLECTING', 'Amy’s buzz')
    host.send({ t: 'act', act: 'powerEnds' })
    await host.until((s) => s.game.status?.label === 'Power ended', 'power to end')
    await host.until((s) => s.round.phase === 'LOCKED', 'the window to close')
    assert.deepEqual(host.last.game.status, { label: 'Power ended', tone: 'inactive' })

    await host.request({ t: 'host', action: { a: 'correct' } })
    assert.equal(host.last.scores[amy.playerId], 250, '200 + the 50 power bonus')
    assert.deepEqual(host.last.round.award, { name: 'Amy', points: 250 })

    host.send({ t: 'act', act: 'revealAnswer', data: 'The answer' })
    await board.until((s) => s.round.answer !== undefined, 'the answer on the board')
    assert.equal(board.last.round.answer, 'The answer')
    await amy.flush()
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

    await host.request({
      t: 'host',
      action: {
        a: 'setMode',
        id: 'quizbowl',
        options: { neg: 50, itemsEnabled: true },
      },
    })

    await host.request({ t: 'host', action: { a: 'setValue', value: 200 } })
    await host.request({ t: 'host', action: { a: 'arm' } })
    await host.untilOpen()

    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await host.until((s) => s.round.phase === 'COLLECTING', 'Amy’s buzz')
    host.send({ t: 'act', act: 'powerEnds' })
    await host.until((s) => s.game.status?.label === 'Power ended', 'power to end')
    await host.until((s) => s.round.phase === 'LOCKED', 'the window to close')

    await host.request({ t: 'host', action: { a: 'wrong', neg: 200 } })
    assert.equal(host.last.scores[amy.playerId], -50, 'the module neg wins over the button')
    assert.deepEqual(host.last.round.lockedOut, [amy.playerId])
    assert.equal(host.last.round.phase, 'ARMED', 'rebound')
    // The module stamps its own penalty, the way it stamps its own payoff, and
    // it rides the rebound so the room sees what the neg cost.
    assert.deepEqual(host.last.round.award, { name: 'Amy', points: -50, penalty: true })

    // The rebound is the same question: power has ended, so Bo's buzz is not
    // powered even though it is first.
    await host.untilOpen()
    bo.send({ t: 'buzz', at: performance.now() + bo.offset })
    await host.until((s) => s.round.phase === 'LOCKED', 'Bo’s buzz to lock the rebound')
    await host.request({ t: 'host', action: { a: 'correct' } })
    assert.equal(host.last.scores[bo.playerId], 200, 'no power on a rebound')
    assert.deepEqual(host.last.round.award, { name: 'Bo', points: 200 }, 'the payoff replaces it')
    // The grant machinery ran: someone holds an item now.
    assert.equal(Object.keys(host.last.items).length, 1)

    for (const c of [host, amy, bo]) c.close()
  })
})
