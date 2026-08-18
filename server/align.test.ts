import test from 'node:test'
import assert from 'node:assert/strict'
import { candidates, completed, join, locate, words, type Probe } from './align.ts'

const FRAGMENTS = [
  'This Italian composer of The Four Seasons',
  'was a priest known as the Red Priest,',
  'and spent much of his career at a Venice orphanage.',
]

test('fragments rejoin into exactly the prose the author typed', () => {
  const j = join(FRAGMENTS)
  assert.equal(
    j.text,
    'This Italian composer of The Four Seasons was a priest known as the Red Priest, ' +
      'and spent much of his career at a Venice orphanage.',
  )
  assert.deepEqual(j.fragmentAt, [0, 42, 80])
  for (const [i, f] of FRAGMENTS.entries()) {
    assert.equal(j.text.slice(j.fragmentAt[i], j.fragmentAt[i] + f.length), f)
  }
  assert.ok(!j.text.includes('/'), 'no marker may survive into what the synthesiser reads')
})

test('a clause never folds past the fragment it would cross into', () => {
  // The first fragment carries no punctuation, so the grammatical clause runs
  // on into the second. Folding at the comma would put the second fragment on
  // the board while only the first has been authorised.
  const j = join(FRAGMENTS)
  const c = candidates(j)
  assert.deepEqual(
    c.filter((x) => x.kind === 'fragment').map((x) => x.at),
    [42, 80],
    'both fragment starts are folds in their own right',
  )
  assert.ok(
    j.text.indexOf(',') > j.fragmentAt[1],
    'the clause break really does sit past the first fragment boundary',
  )
  assert.equal(c[0].at, 42, 'nothing is revealed between the start and the first fragment boundary')
  assert.ok(!c.some((x) => x.kind === 'clause'), 'and the comma, landing on a fragment start, is not folded twice')
})

test('a decimal is not a clause break', () => {
  const j = join(['The population reached 1,200 in 1890, then fell.'])
  assert.deepEqual(
    candidates(j).map((c) => c.at),
    [j.text.indexOf('then')],
    'only the comma with a space after it counts',
  )
})

test('the word count is pessimistic, and forgives how numbers come back', () => {
  const src = words('He also wrote the 1812 Overture, which calls for cannon fire.').map((w) => w.word)
  assert.equal(completed(src, []), 0)
  assert.equal(completed(src, ['he', 'also']), 2)
  // "1812" comes back split across two tokens.
  assert.equal(completed(src, 'he also wrote the 18 12 overture which calls'.split(' ')), 8)
  // "for" heard as "four" at the very end earns no credit — a trailing word is
  // the one most likely to be a stub of a word still being spoken.
  assert.equal(completed(src, 'he also wrote the 18 12 overture which calls four'.split(' ')), 8)
  // ...but the same mishearing mid-transcript must not strand every later fold.
  assert.equal(completed(src, 'he also wrote the 18 12 overture which calls four cannon'.split(' ')), 10)
  // A word it cannot place, with nothing after it to vouch for it, stops the count.
  assert.equal(completed(src, ['he', 'also', 'xyzzy']), 2)
  // Punctuation and case are not differences.
  assert.equal(completed('a Nutcracker.'.split(' '), ['A', 'nutcracker']), 2)
  // One source word arriving as a phrase, and vice versa.
  assert.equal(completed(['ten', 'points'], ['10', 'points']), 2)
})

// What the transcriber actually did to a sentence built to break it. Every
// right-hand side below came out of `say` into `server/stt`, not out of a guess
// about what might go wrong.
const TORTURE_SRC =
  'Antonin Dvorak and Camille Saint-Saens each wrote for two, too, and to the fore ' +
  'of four hundred patrons. Halley\'s Comet returned in 1986, and the 1490s saw Henry ' +
  'VIII crowned, so 50% of the 3rd principal knew the principle. Its price rose $5, ' +
  'and they\'re sure their heir ate eight plain planes there.'
const TORTURE_HEARD =
  "Antonin Dvořák and Camille San scenes he wrote for 22 and to the four of 400 " +
  "patrons Halle's Comet return in 1986 and the 1490s saw Henry the eighth crown so " +
  "50% of the third principal knew the principal it's price rose five dollars and " +
  "they're sure their 88 plane planes there"

test('the mishearings a real transcriber makes do not stall the count', () => {
  const src = words(TORTURE_SRC).map((w) => w.word)
  assert.equal(
    completed(src, TORTURE_HEARD.split(' ')),
    src.length,
    'one mangled proper noun must not strand every later fold at the end of the clip',
  )
})

test('each kind of mishearing, in isolation with no room to recover', () => {
  // Excerpts too short to re-anchor, which is the worst case rather than the
  // normal one: the test above runs the same mishearings inside a full sentence
  // and reaches every word. Where a count here falls short, the cost is a fold
  // placed late, never a word shown early.
  const cases: [string, string, number, string][] = [
    // The transcriber adds the accents the pack author did not type.
    ['Antonin Dvorak and', 'Antonin Dvořák and', 3, 'diacritics appear from nowhere'],
    ['Camille Saint-Saens each wrote for', 'Camille San scenes he wrote for', 5, 'a name shatters into other words'],
    ['Halleys Comet returned in', "Halle's Comet return in", 4, 'possessives and lost inflection'],
    ['Henry VIII crowned, so', 'Henry the eighth crown so', 4, 'a roman numeral becomes a phrase'],
    ['the 3rd principal knew', 'the third principal knew', 4, 'an ordinal spelled out'],
    // Currency splits into two tokens: "$5" pairs off against "five", leaving
    // "dollars" to collide with "and" at the tail, where nothing can vouch for it.
    ['price rose $5, and', 'price rose five dollars and', 3, 'currency becomes two words'],
    // Several words collapsing into one numeral is the one shape no rule here
    // decodes — "two, too" as 22, "four hundred" as 400, "heir ate eight" as 88.
    // Reading them would take real number parsing, ambiguous between digits run
    // together and digits multiplied, to save a fold that resync already
    // rescues whenever two later words survive.
    ['for two, too, and', 'for 22 and', 1, 'two words collapse into one number'],
    ['of four hundred patrons', 'of 400 patrons', 1, 'a compound number collapses'],
    ['their heir ate eight plain', 'their 88 plane', 1, 'three words collapse and the next is wrong'],
    ['knew the principle. Its price', 'knew the principal it\'s price', 5, 'homophones straight through'],
  ]
  for (const [source, heard, want, why] of cases) {
    const src = words(source).map((w) => w.word)
    assert.equal(completed(src, heard.split(' ')), want, `${why}: ${source} -> ${heard}`)
  }
})

test('no transcript credits a word the audio has not reached', () => {
  const src = words(TORTURE_SRC).map((w) => w.word)
  const heard = TORTURE_HEARD.split(' ')
  // Every prefix stands for an earlier cut of the same clip. Counts must climb
  // and never fall: a fold that moved earlier as more audio arrived would put
  // words on the board that the previous probe said were unspoken.
  let prev = 0
  for (let n = 0; n <= heard.length; n++) {
    const got = completed(src, heard.slice(0, n))
    assert.ok(got >= prev, `prefix of ${n} counted ${got}, down from ${prev}`)
    assert.ok(got <= src.length, `counted ${got} of ${src.length} source words`)
    prev = got
  }
})

test('resync needs evidence, and a dropped word is not evidence of the next one', () => {
  const src = 'alpha bravo charlie delta echo foxtrot'.split(' ')
  // Nothing heard yet, nothing complete — the empty case a probe before the
  // first word returns.
  assert.equal(completed(src, []), 0)
  // A clean prefix is exactly itself. Resync must not run ahead of the audio.
  assert.equal(completed(src, ['alpha', 'bravo']), 2)
  // A word the transcriber dropped entirely is still credited, because the two
  // words after it arrived — that is evidence the audio passed it.
  assert.equal(completed(src, ['alpha', 'charlie', 'delta']), 4)
  // But a lone unrecognisable tail earns nothing: it may be a stub of a word
  // still being spoken.
  assert.equal(completed(src, ['alpha', 'zzzz']), 1)
  // And a match too far ahead to be plausible is not a resync.
  assert.equal(completed('a b c d e f g h i j k l m n o p'.split(' '), ['a', 'o', 'p']), 1)
  // Regaining the thread takes two words running, which the end of a probe
  // cannot supply — so a mishearing in the last word or two of a transcript
  // stops the count rather than being forgiven. That is the safe direction:
  // the audio is still arriving, and the next probe will settle it.
  // A word that lines up exactly one-for-one is forgiven on a single following
  // match, since nothing about the sequence has shifted.
  assert.equal(completed(src, ['alpha', 'zzzz', 'charlie']), 3, 'a clean substitution needs one witness')
  // Regaining the thread after the sequence *has* shifted takes two words
  // running, which the end of a probe cannot supply — so a collapse in the last
  // word or two stops the count instead of guessing. The audio is still
  // arriving; the next probe settles it.
  // Two words lost at once, and both are credited: "delta echo" surviving
  // afterwards is proof the audio travelled past them.
  assert.equal(completed(src, ['alpha', 'zzzz', 'delta', 'echo']), 5, 'a shift needs two witnesses')
  assert.equal(completed(src, ['alpha', 'zzzz', 'delta']), 1, 'and one is not two')
})

/** An oracle over a table of "word k finishes at ms", with no machine behind it. */
function oracle(text: string, endMs: number[]): { probe: Probe; calls: () => number } {
  const src = words(text).map((w) => w.word)
  let calls = 0
  return {
    calls: () => calls,
    probe: async (_from, to) => {
      calls++
      return src.slice(0, endMs.filter((ms) => ms <= to).length)
    },
  }
}

test('bisection finds every boundary, and never places one early', async () => {
  const j = join(['One two three.', 'Four five six.'])
  const src = words(j.text)
  // Deliberately uneven, so a linear guess would be wrong everywhere.
  const endMs = [300, 500, 1400, 1600, 1700, 2600]
  assert.equal(src.length, endMs.length)
  const { probe, calls } = oracle(j.text, endMs)

  const folds = await locate(j, 3000, probe, 25)
  assert.ok(calls() > 0 && calls() < 200, `probe count stays sane, got ${calls()}`)

  for (const f of folds) {
    const heard = src.filter((w) => w.at < f.at).length
    assert.ok(
      f.ms >= endMs[heard - 1],
      `fold at ${f.at} fires at ${f.ms}, before word ${heard} finished at ${endMs[heard - 1]}`,
    )
    assert.ok(
      f.ms - endMs[heard - 1] <= 60,
      `fold at ${f.at} lags ${f.ms - endMs[heard - 1]}ms, further than the resolution explains`,
    )
  }
})

test('an oracle that stutters cannot drag a fold earlier than its bracket', async () => {
  const j = join(['One two three.', 'Four five six.'])
  const endMs = [300, 500, 1400, 1600, 1700, 2600]
  const src = words(j.text).map((w) => w.word)
  let n = 0
  // Every third probe under-reports, the way endpointing holds a short word
  // back until its neighbour resolves.
  const probe: Probe = async (_f, to) => {
    const real = endMs.filter((ms) => ms <= to).length
    n++
    return src.slice(0, n % 3 === 0 ? Math.max(0, real - 1) : real)
  }

  const folds = await locate(j, 3000, probe, 25)
  for (const f of folds) {
    const heard = words(j.text).filter((w) => w.at < f.at).length
    assert.ok(
      f.ms >= endMs[heard - 1],
      `a stuttering oracle pulled a fold to ${f.ms}, before ${endMs[heard - 1]}`,
    )
  }
})
