import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sttBinary, transcribe } from './stt.ts'

function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pb-stt-'))
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('a transcript comes back trimmed; a failing binary is a null, not a throw', async () => {
  await withDir(async (dir) => {
    const ok = join(dir, 'ok')
    writeFileSync(ok, '#!/bin/sh\necho "  the green mountain state  "\n')
    chmodSync(ok, 0o755)
    assert.equal(await transcribe(ok, '/tmp/whatever.wav'), 'the green mountain state')

    const bad = join(dir, 'bad')
    writeFileSync(bad, '#!/bin/sh\nexit 1\n')
    chmodSync(bad, 0o755)
    assert.equal(await transcribe(bad, '/tmp/whatever.wav'), null)

    assert.equal(await transcribe(join(dir, 'missing'), '/tmp/whatever.wav'), null)
  })
})

test('no stt.swift in the directory means no binary and no swiftc invocation', async () => {
  await withDir(async (dir) => {
    assert.equal(await sttBinary(dir), null)
  })
})
