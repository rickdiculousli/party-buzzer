import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSetlists, readSetlist, writeSetlist } from './setlists.ts'
import { packSizes } from './packs.ts'
import { catalog } from './modes/index.ts'
import { MINIGAME_OPTIONS } from '../shared/protocol.ts'
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

// The setlists shipped in the repository are recipes a host can play as they
// are, so every block has to be runnable by this build and fed by a pack that
// is big enough for the whole night: a pack keeps its place across blocks, so
// the counts that name it add up.
const shipped = join(import.meta.dirname, '..', 'setlists')
const packDir = join(import.meta.dirname, '..', 'packs')

test('every shipped setlist names games, rules and options this build knows', () => {
  const games = new Map(catalog().map((g) => [g.id, g.options.map((o) => o.key)]))
  for (const [id, specs] of Object.entries(MINIGAME_OPTIONS)) games.set(id, specs.map((o) => o.key))
  for (const name of listSetlists(shipped)) {
    const raw = JSON.parse(readFileSync(join(shipped, name), 'utf8')) as unknown[]
    const blocks = readSetlist(shipped, name)
    assert.equal(blocks.length, raw.length, `${name}: a block was dropped as unknown`)
    for (const [i, block] of blocks.entries()) {
      const keys = games.get(block.game)
      assert.ok(keys, `${name} block ${i}: unknown game ${block.game}`)
      for (const key of Object.keys(block.options)) {
        assert.ok(keys.includes(key), `${name} block ${i}: ${block.game} has no option ${key}`)
      }
    }
  }
})

test('every shipped setlist fits the packs it reads from', () => {
  for (const name of listSetlists(shipped)) {
    const asked: Record<string, number> = {}
    for (const block of readSetlist(shipped, name)) {
      if (block.pack) asked[block.pack] = (asked[block.pack] ?? 0) + block.count
    }
    const sizes = packSizes(packDir, Object.keys(asked))
    for (const [pack, count] of Object.entries(asked)) {
      assert.ok(sizes[pack] > 0, `${name}: pack ${pack} is missing or empty`)
      assert.ok(count <= sizes[pack], `${name}: asks ${pack} for ${count} questions, it has ${sizes[pack]}`)
    }
  }
})
