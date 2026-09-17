import test from 'node:test'
import assert from 'node:assert/strict'

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
