import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listPacks, loadPack } from './packs.ts'

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pb-packs-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

test('listPacks returns sorted .txt basenames and ignores everything else', () => {
  const dir = dirWith({
    'zulu.txt': 'Q. / R.\nA: a',
    'alpha.txt': 'Q. / R.\nA: a',
    'notes.md': 'ignore me',
  })
  mkdirSync(join(dir, '.cache'))
  assert.deepEqual(listPacks(dir), ['alpha.txt', 'zulu.txt'])
})

test('listPacks on a missing directory is empty, not an error', () => {
  assert.deepEqual(listPacks(join(tmpdir(), 'pb-does-not-exist-'+ Date.now())), [])
})

test('loadPack parses the named file', () => {
  const dir = dirWith({ 'one.txt': 'V: 300\nFirst. / Second.\nA: gold' })
  const { questions, errors } = loadPack(dir, 'one.txt')
  assert.deepEqual(errors, [])
  assert.equal(questions.length, 1)
  assert.equal(questions[0].value, 300)
  assert.deepEqual(questions[0].fragments, ['First.', 'Second.'])
  assert.equal(questions[0].answer, 'gold')
})

test('loadPack refuses a name that escapes the pack directory', () => {
  const dir = dirWith({ 'one.txt': 'First.\nA: a' })
  assert.throws(() => loadPack(dir, '../../etc/passwd'), /outside the pack directory/)
})
