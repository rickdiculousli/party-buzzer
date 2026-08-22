import test from 'node:test'
import assert from 'node:assert/strict'
import { candidates, completed, join, locate, words, type Transcriber } from './align.ts'

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
  assert.ok(!c.some((x) => x.kind === 'clause'), 'and the comma, landing on a fragment start, is not folded twice')
})

test('a decimal is not a clause break', () => {
  const j = join(['The population reached 1,200 in 1890, then fell.'])
  assert.deepEqual(
    candidates(j).filter((c) => c.kind === 'clause').map((c) => c.at),
    [j.text.indexOf('then')],
    'only the comma with a space after it counts',
  )
  assert.deepEqual(
    candidates(j).filter((c) => c.kind === 'end').map((c) => c.at),
    [j.text.length],
    'and the close of the question is always a fold',
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
  // words on the board that the previous transcription said were unspoken.
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
  // Nothing heard yet, nothing complete — the empty case a transcription before the
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
  // Regaining the thread takes two words running,   // cannot supply — so a mishearing in the last word or two of a transcript
  // stops the count rather than being forgiven. That is the safe direction:
  // the audio is still arriving, and the next transcription will settle it.
  // A word that lines up exactly one-for-one is forgiven on a single following
  // match, since nothing about the sequence has shifted.
  assert.equal(completed(src, ['alpha', 'zzzz', 'charlie']), 3, 'a clean substitution needs one witness')
  // Regaining the thread after the sequence *has* shifted takes two words
  // running, which the end of a transcript cannot supply — so a collapse in the last
  // word or two stops the count instead of guessing. The audio is still
  // arriving; the next transcription settles it.
  // Two words lost at once, and both are credited: "delta echo" surviving
  // afterwards is proof the audio travelled past them.
  assert.equal(completed(src, ['alpha', 'zzzz', 'delta', 'echo']), 5, 'a shift needs two witnesses')
  assert.equal(completed(src, ['alpha', 'zzzz', 'delta']), 1, 'and one is not two')
})

/**
 * An oracle over a table of "word k finishes at ms", with no machine behind it.
 * A window contains the words that finished inside it, which is what the helper
 * returns when asked for a range rather than a prefix.
 */
function oracle(text: string, endMs: number[]): { transcribe: Transcriber; calls: () => number } {
  const src = words(text).map((w) => w.word)
  const doneBy = (ms: number) => endMs.filter((e) => e <= ms).length
  let calls = 0
  return {
    calls: () => calls,
    transcribe: async (from, to) => {
      calls++
      return src.slice(doneBy(from), doneBy(to))
    },
  }
}

test('a clause goes up as the voice begins it, not when it finishes it', async () => {
  const j = join(['One two three.', 'Four five six.'])
  const src = words(j.text)
  // Deliberately uneven, so a linear guess would be wrong everywhere.
  const endMs = [300, 500, 1400, 1600, 1700, 2600]
  assert.equal(src.length, endMs.length)
  const { transcribe, calls } = oracle(j.text, endMs)

  const folds = await locate(j, 3000, transcribe, 25)
  assert.ok(calls() > 0 && calls() < 200, `transcription count stays sane, got ${calls()}`)

  // Two folds: the first fragment, then the close. Each reveals one clause.
  assert.deepEqual(folds.map((f) => f.at), [15, 29])
  // The first clause is on the board before a word of it has been said.
  assert.equal(folds[0].ms, 0, 'the question opens with its first clause already up')
  // The second goes up as "Four" begins — which is the instant "three" ended,
  // not the instant "six" did. Firing on the last word instead leaves the line
  // a whole clause behind the reader.
  assert.ok(
    Math.abs(folds[1].ms - endMs[2]) <= 25,
    `second clause fires at ${folds[1].ms}, not as "Four" begins at ${endMs[2]}`,
  )
  assert.ok(folds[1].ms < endMs[5], 'and nowhere near when the clause finishes')
})

test('words the search cannot separate are spread across the gap, not lumped at its end', async () => {
  // An oracle that only ever admits words in pairs — it will not credit the
  // first of a pair until the second is done. That is what the real one's
  // pessimism does, and left alone it lands both at the moment the second
  // finished: measured against real speech, "It is what the" arrived in one
  // lump a full second after "It" was spoken. There is no more measuring to be
  // done, only the knowledge that the words are in order and share the gap.
  const j = join(['One two three, four five six.'])
  const src = words(j.text).map((w) => w.word)
  const endMs = [500, 1000, 1500, 2000, 2500, 3000]
  const doneBy = (ms: number) => {
    const n = endMs.filter((e) => e <= ms).length
    return n - (n % 2)
  }
  const transcribe: Transcriber = async (from, to) => src.slice(doneBy(from), doneBy(to))

  const folds = await locate(j, 3500, transcribe, 25)
  assert.deepEqual(folds.map((f) => f.at), [15, 29], 'the clause break and the close')
  assert.equal(folds[0].ms, 0)
  // "four" opens the second clause. It is the first of its pair, so the search
  // could only place it with its partner at 2000 — half a second late. Sharing
  // the gap since the last time we trust puts it back at its onset.
  assert.ok(
    Math.abs(folds[1].ms - 1500) <= 60,
    `second clause fires at ${folds[1].ms}, not as "four" begins at 1500`,
  )
})

test('an oracle that stutters cannot drag a fold earlier than its bracket', async () => {
  const j = join(['One two three.', 'Four five six.'])
  const endMs = [300, 500, 1400, 1600, 1700, 2600]
  const src = words(j.text).map((w) => w.word)
  let n = 0
  // Every third transcription under-reports, the way endpointing holds a short word
  // back until its neighbour resolves.
  const doneBy = (ms: number) => endMs.filter((e) => e <= ms).length
  const transcribe: Transcriber = async (from, to) => {
    const real = doneBy(to)
    n++
    return src.slice(doneBy(from), n % 3 === 0 ? Math.max(doneBy(from), real - 1) : real)
  }

  const folds = await locate(j, 3000, transcribe, 25)
  // A fold fires as the clause it reveals begins — so never before every word
  // of the clause BEFORE it has been said. That is the floor a stuttering
  // oracle must not drag it under.
  let prevK = 0
  for (const f of folds) {
    const floor = prevK === 0 ? 0 : endMs[prevK - 1]
    assert.ok(
      f.ms >= floor,
      `a stuttering oracle pulled a fold to ${f.ms}, before the voice reached ${floor}`,
    )
    prevK = words(j.text).filter((w) => w.at < f.at).length
  }
})
