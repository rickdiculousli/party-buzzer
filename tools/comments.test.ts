import test from 'node:test'
import assert from 'node:assert/strict'
import { comments, isPragma, ratchet, strip } from './comments.ts'

test('the code carries no more comments than its baseline allows', () => {
  assert.deepEqual(ratchet(), [])
})

test('the ratchet refuses a new comment and a loose baseline', () => {
  assert.deepEqual(ratchet({ 'a.ts': 1 }, { 'a.ts': 1 }), [])
  assert.equal(ratchet({ 'a.ts': 2 }, { 'a.ts': 1 }).length, 1)
  assert.equal(ratchet({ 'b.ts': 1 }, {}).length, 1)
  assert.equal(ratchet({}, { 'a.ts': 1 }).length, 1)
})

test('comments are found in code, after code and in JSX, never in strings or JSX text', () => {
  const src = 'const a = <div>\n  {/* why */}\n  <a href="//x">// text</a>{/* inline */}\n</div>\nconst b = 1 // trail\ntry { x() } catch { /* nothing */ }\nconst s = "// not"\n'
  assert.deepEqual(comments('x.tsx', src).map((c) => c.text), ['/* why */', '/* inline */', '// trail', '/* nothing */'])
  assert.equal(strip('x.tsx', src), 'const a = <div>\n  <a href="//x">// text</a>\n</div>\nconst b = 1\ntry { x() } catch { }\nconst s = "// not"\n')
})

test('strip leaves no doubled blank line and no blank line opening a block', () => {
  assert.equal(strip('x.ts', 'a\n\n// one\n// two\n\nb\n'), 'a\n\nb\n')
  assert.equal(strip('x.ts', 'f() {\n  // why\n\n  b\n}\n'), 'f() {\n  b\n}\n')
})

test('CSS, HTML and Swift comments are found outside strings; markers and pragmas are kept', () => {
  assert.deepEqual(comments('x.css', 'a { content: "/* no */"; } /* yes */').map((c) => c.text), ['/* yes */'])
  assert.deepEqual(comments('x.html', '<p>a</p><!-- yes -->').map((c) => c.text), ['<!-- yes -->'])
  assert.deepEqual(comments('x.swift', 'let s = "// no" // yes\n').map((c) => c.text), ['// yes'])
  assert.ok(isPragma('/* anim:tunables */') && isPragma('/* /cue:recipes */') && isPragma('/// <reference types="vite/client" />'))
  assert.ok(!isPragma('/* anim:tunables — a label */') && !isPragma('// why'))
  assert.equal(strip('x.css', '/* anim:tunables */\n/* why */\na {}\n'), '/* anim:tunables */\na {}\n')
})
