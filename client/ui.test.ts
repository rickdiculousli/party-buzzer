import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buzzerFace, chunks } from './ui.ts'

test('chunks: mostly pairs, a single every third beat', () => {
  assert.deepEqual(chunks('the capital of france is paris'), [
    'the',
    'capital of',
    'france is',
    'paris',
  ])
  assert.deepEqual(chunks('paris'), ['paris'])
  assert.deepEqual(chunks(''), [])
  assert.deepEqual(chunks('  spaced   out '), ['spaced', 'out'])
})

/**
 * One question from the runner-up's phone, beat by beat. Every bug this chain
 * has had was a branch matching in a state nobody was thinking about, so the
 * check is a walk rather than a table: the states arrive in this order, and the
 * one that keeps breaking is the last of them.
 */
test('buzzerFace: a question from second place', () => {
  const base = {
    frozen: false, barred: false, dead: false, spectator: false,
    won: false, answering: false, held: false,
    pressed: false, armed: false, open: false,
  }
  const face = (f: Partial<typeof base> & Record<string, unknown>) =>
    buzzerFace({ ...base, ...f })

  assert.equal(face({}).label, 'Wait', 'nothing armed')
  assert.equal(face({ armed: true }).sub, 'Any moment', 'armed, still counting down')
  assert.equal(face({ armed: true, open: true }).label, 'Buzz')
  // Pressed, window still filling: the room learns nothing for a whole second.
  assert.equal(face({ armed: true, open: true, pressed: true }).label, 'In')
  // Locked, and this press was not first. The margin is a subtitle, not a
  // screen of its own — it is already on the board in front of the room.
  const second = face({ pressed: true, answering: true, deltaMs: 120 })
  assert.deepEqual(second, { label: 'Locked', sub: '+120 ms', mood: 'is-barred' })

  // The one that kept regressing: the host scores it. IDLE is neither armed nor
  // locked, and `pressed` is keyed on the arm so it is still true — this fell
  // back through to "In" twice, once per fix that named a state instead of the
  // round being live.
  assert.equal(face({ pressed: true }).label, 'Wait', 'scored — back to waiting')
})

test('buzzerFace: the answerer, the rebound, and who outranks whom', () => {
  const base = {
    frozen: false, barred: false, dead: false, spectator: false,
    won: false, answering: false, held: false,
    pressed: false, armed: false, open: false,
  }
  const face = (f: Partial<typeof base>) => buzzerFace({ ...base, ...f })

  assert.equal(face({ won: true, answering: true, pressed: true }).label, 'You’re up')
  // ...and only while it is theirs. Scored, it is a wait like anyone else's.
  assert.equal(face({ won: true, pressed: true }).label, 'Wait')

  // A held rebound: shut, but about to open, so it says so rather than "out".
  assert.deepEqual(face({ held: true }), {
    label: 'Locked', sub: 'Reopening in a moment', mood: 'is-barred',
  })
  // Whoever missed is locked out, and that outranks the rebound they cannot
  // take part in.
  assert.equal(face({ held: true, barred: true }).label, 'Out')
  // A freeze outranks everything, including an open buzzer.
  assert.equal(face({ frozen: true, barred: true, open: true, armed: true }).label, 'Frozen')
})
