import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('queueBatch passes the exact thread and request path as inert arguments', async () => {
  const mod = await import('./review/codex.ts').catch(() => ({})) as {
    queueBatch?: (
      input: { threadId: string; cwd: string; batchId: string; requestPath: string },
      run: (command: string, args: string[], options: { cwd: string; timeoutMs: number }) => Promise<unknown>,
    ) => Promise<void>
  }
  assert.equal(typeof mod.queueBatch, 'function')

  const calls: unknown[][] = []
  const requestPath = '/tmp/review `quoted` $(touch nope)\nsecond line/request.md'
  await mod.queueBatch!(
    {
      threadId: '01a0ad51-cdd5-7873-9beb-fcb8e2f7fc8b',
      cwd: '/repo/party-buzzer',
      batchId: 'batch-123',
      requestPath,
    },
    async (...args) => {
      calls.push(args)
      return { status: 'ok', stdout: '', stderr: '' }
    },
  )

  assert.deepEqual(calls, [[
    'codex',
    [
      'queue',
      '--thread',
      '01a0ad51-cdd5-7873-9beb-fcb8e2f7fc8b',
      '--message',
      `Review batch batch-123. Read ${requestPath}.`,
    ],
    { cwd: '/repo/party-buzzer', timeoutMs: 10_000 },
  ]])
})

test('queueBatch reports missing binary, timeout, and command failure distinctly', async () => {
  const { queueBatch } = await import('./review/codex.ts')
  const input = {
    threadId: '01a0ad51-cdd5-7873-9beb-fcb8e2f7fc8b',
    cwd: '/repo/party-buzzer',
    batchId: 'batch-123',
    requestPath: '/repo/party-buzzer/.review/batches/batch-123/request.md',
  }

  for (const status of ['missing-binary', 'timeout', 'failed'] as const) {
    await assert.rejects(
      queueBatch(input, async () => ({ status, stdout: '', stderr: 'bounded detail' })),
      (error: unknown) => {
        assert.equal((error as { reason?: string }).reason, status)
        assert.match((error as Error).message, /bounded detail/)
        return true
      },
    )
  }
})

test('runProcess distinguishes missing commands, timeouts, and bounded nonzero diagnostics', async () => {
  const mod = await import('./review/codex.ts') as {
    runProcess?: (
      command: string,
      args: string[],
      options: { cwd: string; timeoutMs: number },
    ) => Promise<{ status: string; stderr: string; exitCode?: number }>
  }
  assert.equal(typeof mod.runProcess, 'function')

  const missing = await mod.runProcess!('__party_buzzer_missing_codex__', [], {
    cwd: process.cwd(),
    timeoutMs: 1_000,
  })
  assert.equal(missing.status, 'missing-binary')

  const timedOut = await mod.runProcess!(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: process.cwd(),
    timeoutMs: 20,
  })
  assert.equal(timedOut.status, 'timeout')

  const failed = await mod.runProcess!(
    process.execPath,
    ['-e', "process.stderr.write('x'.repeat(5000)); process.exit(7)"],
    { cwd: process.cwd(), timeoutMs: 1_000 },
  )
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exitCode, 7)
  assert.equal(failed.stderr.length, 2_000)
})

test('review scenarios use Hub projections for board and phone state', async () => {
  const mod = await import('./review/fixtures.ts').catch(() => ({})) as {
    makeReviewScenarios?: () => Array<{
      id: string
      board: { round: { order: unknown[]; whole?: string }; reading?: unknown }
      phones: Array<{
        playerId: string
        state: { round: { order: Array<{ playerId: string }>; whole?: string }; reading?: unknown }
      }>
    }>
  }
  assert.equal(typeof mod.makeReviewScenarios, 'function')

  const scenario = mod.makeReviewScenarios!().find((item) => item.id === 'collecting')
  assert.ok(scenario)
  assert.equal(scenario.board.round.order.length, 2)
  assert.ok(scenario.board.round.whole)
  assert.ok(scenario.board.reading)
  for (const phone of scenario.phones) {
    assert.ok(phone.state.round.order.every((entry) => entry.playerId === phone.playerId))
    assert.equal(phone.state.round.whole, undefined)
    assert.equal(phone.state.reading, undefined)
  }
})

test('review scenarios cover the main board and phone moments', async () => {
  const { makeReviewScenarios } = await import('./review/fixtures.ts')
  assert.deepEqual(makeReviewScenarios().map((scenario) => scenario.id), [
    'welcome',
    'waiting',
    'delay',
    'open',
    'collecting',
    'leader-answering',
    'correct',
    'wrong-hold',
    'rebound',
    'duel',
    'setlist-complete',
  ])
})

test('createBatch atomically preserves an immutable request and its captures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-buzzer-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const mod = await import('./review/batches.ts').catch(() => ({})) as {
    createBatch?: (input: unknown, deps: unknown) => Promise<{ id: string; dir: string }>
  }
  assert.equal(typeof mod.createBatch, 'function')
  const id = '11111111-1111-4111-8111-111111111111'
  const annotation = {
    id: 'note-1', scenarioId: 'rebound', surface: 'phone', playerId: 'ada',
    text: 'Explain when this player can buzz again.', targetId: 'phone:buzzer',
    bounds: { x: 10, y: 20, width: 30, height: 40 }, scroll: { x: 0, y: 0 }, status: 'open',
  }
  const batch = await mod.createBatch!(
    {
      threadId: '01a0ad51-cdd5-7873-9beb-fcb8e2f7fc8b',
      annotations: [annotation],
      sourceRevision: 'abc123',
      changedFiles: [' M client/Player.tsx'],
    },
    {
      root,
      id: () => id,
      capture: async (dir: string) => {
        await writeFile(join(dir, 'phone-rebound-ada.png'), 'png')
        return { 'phone:rebound:ada': 'phone-rebound-ada.png' }
      },
    },
  )

  assert.equal(batch.id, id)
  const request = await readFile(join(batch.dir, 'request.md'), 'utf8')
  assert.match(request, /Explain when this player can buzz again/)
  assert.match(request, /phone-rebound-ada\.png/)
  const manifest = JSON.parse(await readFile(join(batch.dir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, 1)
  assert.deepEqual(manifest.annotations, [annotation])
  await assert.rejects(mod.createBatch!(
    {
      threadId: '01a0ad51-cdd5-7873-9beb-fcb8e2f7fc8b', annotations: [annotation],
      sourceRevision: 'abc123', changedFiles: [],
    },
    { root, id: () => id, capture: async () => ({}) },
  ))
})

test('createBatch leaves no submitted directory when capture fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-buzzer-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { createBatch } = await import('./review/batches.ts')
  const id = '22222222-2222-4222-8222-222222222222'
  await assert.rejects(createBatch(
    {
      threadId: 'thread', annotations: [], sourceRevision: 'abc123', changedFiles: [],
    },
    { root, id: () => id, capture: async () => { throw new Error('capture failed') } },
  ), /capture failed/)
  await assert.rejects(readFile(join(root, id, 'manifest.json')))
})

test('createBatch rejects a capture when the source revision changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-buzzer-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { createBatch } = await import('./review/batches.ts')
  const id = '55555555-5555-4555-8555-555555555555'
  await assert.rejects(createBatch(
    {
      threadId: 'thread', annotations: [], sourceRevision: 'before', changedFiles: [],
    },
    {
      root,
      id: () => id,
      capture: async () => ({}),
      currentRevision: async () => 'after',
    },
  ), /source changed.*refresh/i)
  await assert.rejects(readFile(join(root, id, 'manifest.json')))
})

test('SubmissionGate runs simultaneous requests for one batch only once', async () => {
  const mod = await import('./review/plugin.ts').catch(() => ({})) as {
    SubmissionGate?: new () => {
      run: <T>(id: string, work: () => Promise<T>) => Promise<T>
    }
  }
  assert.equal(typeof mod.SubmissionGate, 'function')
  const gate = new mod.SubmissionGate!()
  let runs = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const work = async () => {
    runs += 1
    await held
    return { status: 'submitted' }
  }
  const first = gate.run('same-batch', work)
  const second = gate.run('same-batch', work)
  release()
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'submitted' },
    { status: 'submitted' },
  ])
  assert.equal(runs, 1)
})

test('markSubmitted preserves an acknowledgment that arrived while queueing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-buzzer-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const id = '66666666-6666-4666-8666-666666666666'
  await writeFile(join(root, 'status.json'), JSON.stringify({ batchId: id, status: 'acknowledged' }))
  const mod = await import('./review/plugin.ts').catch(() => ({})) as {
    markSubmitted?: (dir: string, id: string) => Promise<{ status: string }>
  }
  assert.equal(typeof mod.markSubmitted, 'function')
  assert.equal((await mod.markSubmitted!(root, id)).status, 'acknowledged')
  assert.equal(JSON.parse(await readFile(join(root, 'status.json'), 'utf8')).status, 'acknowledged')
})

test('reportBatch acknowledges and completes only the named saved batch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-buzzer-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const id = '33333333-3333-4333-8333-333333333333'
  const dir = join(root, id)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir)
  await writeFile(join(dir, 'status.json'), JSON.stringify({ batchId: id, status: 'submitted' }))
  const mod = await import('./review/report.ts').catch(() => ({})) as {
    reportBatch?: (root: string, id: string, status: string, message?: string) => Promise<unknown>
  }
  assert.equal(typeof mod.reportBatch, 'function')
  await mod.reportBatch!(root, id, 'acknowledged')
  await mod.reportBatch!(root, id, 'ready', 'Implemented and tested.')
  const saved = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8'))
  assert.deepEqual(saved, { batchId: id, status: 'ready', message: 'Implemented and tested.' })
  await assert.rejects(
    mod.reportBatch!(root, '44444444-4444-4444-8444-444444444444', 'ready'),
  )
})
