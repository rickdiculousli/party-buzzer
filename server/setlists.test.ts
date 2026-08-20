import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSetlists, readSetlist, writeSetlist } from './setlists.ts'
import type { SetlistBlock } from '../shared/protocol.ts'

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-setlists-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const blocks: SetlistBlock[] = [{ game: 'trivia', options: {}, count: 3, value: 200 }]

test('a missing directory is a room with no saved setlists', () => {
  assert.deepEqual(listSetlists(join(tmpdir(), 'buzzer-setlists-does-not-exist')), [])
})

test('writing then listing then reading round-trips the blocks', () => {
  withDir((dir) => {
    const name = writeSetlist(dir, 'Quiz Night', blocks)
    assert.equal(name, 'quiz-night.json')
    assert.deepEqual(listSetlists(dir), ['quiz-night.json'])
    assert.deepEqual(readSetlist(dir, 'quiz-night.json'), blocks)
  })
})

test('the extension follows from the format, not from what was typed', () => {
  withDir((dir) => {
    assert.equal(writeSetlist(dir, 'night.json', blocks), 'night.json')
    assert.equal(writeSetlist(dir, 'other.txt', blocks), 'other-txt.json')
  })
})

test('a name that escapes the directory is refused, reading and writing alike', () => {
  withDir((dir) => {
    assert.throws(() => readSetlist(dir, '../state.json'), /outside/)
    assert.throws(() => writeSetlist(dir, '../escape', blocks), /outside/)
    assert.throws(() => writeSetlist(dir, '   ', blocks), /empty/)
  })
})

test('a setlist naming a module this build does not register loads without it', () => {
  withDir((dir) => {
    writeFileSync(
      join(dir, 'mixed.json'),
      JSON.stringify([{ game: 'chess', options: {}, count: 2 }, blocks[0]]),
    )
    assert.deepEqual(readSetlist(dir, 'mixed.json'), blocks)
  })
})

test('an unreadable setlist file is an empty setlist, not a crash', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    assert.deepEqual(readSetlist(dir, 'broken.json'), [])
  })
})
