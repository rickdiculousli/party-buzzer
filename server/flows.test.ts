import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listFlows, readFlow, writeFlow } from './flows.ts'
import type { FlowBlock } from '../shared/protocol.ts'

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-flows-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const blocks: FlowBlock[] = [{ game: 'trivia', options: {}, count: 3, value: 200 }]

test('a missing directory is a room with no saved flows', () => {
  assert.deepEqual(listFlows(join(tmpdir(), 'buzzer-flows-does-not-exist')), [])
})

test('writing then listing then reading round-trips the blocks', () => {
  withDir((dir) => {
    const name = writeFlow(dir, 'Quiz Night', blocks)
    assert.equal(name, 'quiz-night.json')
    assert.deepEqual(listFlows(dir), ['quiz-night.json'])
    assert.deepEqual(readFlow(dir, 'quiz-night.json'), blocks)
  })
})

test('the extension follows from the format, not from what was typed', () => {
  withDir((dir) => {
    assert.equal(writeFlow(dir, 'night.json', blocks), 'night.json')
    assert.equal(writeFlow(dir, 'other.txt', blocks), 'other-txt.json')
  })
})

test('a name that escapes the directory is refused, reading and writing alike', () => {
  withDir((dir) => {
    assert.throws(() => readFlow(dir, '../state.json'), /outside/)
    assert.throws(() => writeFlow(dir, '../escape', blocks), /outside/)
    assert.throws(() => writeFlow(dir, '   ', blocks), /empty/)
  })
})

test('a flow naming a module this build does not register loads without it', () => {
  withDir((dir) => {
    writeFileSync(
      join(dir, 'mixed.json'),
      JSON.stringify([{ game: 'chess', options: {}, count: 2 }, blocks[0]]),
    )
    assert.deepEqual(readFlow(dir, 'mixed.json'), blocks)
  })
})

test('an unreadable flow file is an empty setlist, not a crash', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    assert.deepEqual(readFlow(dir, 'broken.json'), [])
  })
})
