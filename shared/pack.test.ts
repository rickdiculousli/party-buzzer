import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePack } from './pack.ts'

test('a full pack: values, fragments, continuations, answers', () => {
  const { questions, errors } = parsePack(`V: 200
The first fragment, spoken first. / The second fragment, which
ends the power window. / The giveaway.
A: The answer

This one has no value and two fragments. / Second fragment.
A: Another answer
`)
  assert.deepEqual(errors, [])
  assert.equal(questions.length, 2)
  assert.equal(questions[0].value, 200)
  assert.deepEqual(questions[0].fragments, [
    'The first fragment, spoken first.',
    'The second fragment, which ends the power window.',
    'The giveaway.',
  ])
  assert.equal(questions[0].answer, 'The answer')
  assert.equal(questions[1].value, undefined)
  assert.deepEqual(questions[1].fragments, [
    'This one has no value and two fragments.',
    'Second fragment.',
  ])
})

test('a question without an A: line is skipped and the error names the line', () => {
  const { questions, errors } = parsePack(`No answer here. / Still none.

Good question.
A: Yes
`)
  assert.equal(questions.length, 1)
  assert.equal(questions[0].answer, 'Yes')
  assert.equal(errors.length, 1)
  assert.match(errors[0], /line 1/)
})

test('an I: line attaches an image; a path leaving the pack directory is refused', () => {
  const { questions, errors } = parsePack(`What is this?
I: images/tower.jpg
A: Eiffel Tower

What is this?
I: ../secret.png
A: Nothing
`)
  assert.equal(questions[0].image, 'images/tower.jpg')
  assert.equal(questions[1].image, undefined)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /line 6/)
})

test('a bad V: line is named and does not kill the question', () => {
  const { questions, errors } = parsePack(`V: lots
Real question.
A: Real answer
`)
  assert.equal(questions.length, 1)
  assert.equal(questions[0].value, undefined)
  assert.match(errors[0], /line 1/)
})

test('an empty pack parses to nothing, no errors', () => {
  assert.deepEqual(parsePack('\n\n'), { questions: [], errors: [] })
})

test('an A: line split on " | " carries every variant, first one is the display answer', () => {
  const { questions, errors } = parsePack(`Question one.
A: Vermont | VT | the Green Mountain State
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].answer, 'Vermont')
  assert.deepEqual(questions[0].answers, ['Vermont', 'VT', 'the Green Mountain State'])
})

test('a plain A: line is one variant — existing packs parse unchanged', () => {
  const { questions, errors } = parsePack(`Question one.
A: gold
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].answer, 'gold')
  assert.deepEqual(questions[0].answers, ['gold'])
})

test('K: shown marks a question shown; K: read is the default', () => {
  const { questions, errors } = parsePack(`K: shown
Shown question.
A: yes

K: read
Read question.
A: yes
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].kind, 'shown')
  assert.equal(questions[1].kind, undefined)
})

test('a C: line makes a choice question and records the right index', () => {
  const { questions, errors } = parsePack(`V: 200
C: Mars | Venus | Saturn | Jupiter
Which planet has the most moons?
A: saturn
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].kind, 'choice')
  assert.deepEqual(questions[0].choices, ['Mars', 'Venus', 'Saturn', 'Jupiter'])
  assert.equal(questions[0].correct, 2)
  assert.equal(questions[0].value, 200)
})

test('bad choice questions are skipped with a reason', () => {
  const { questions, errors } = parsePack(`C: Mars | Venus
Q one.
A: Pluto

C: Only
Q two.
A: Only

C: a | b | c | d | e | f | g
Q three.
A: a

K: shown
C: a | b
Q four.
A: a

K: choice
Q five.
A: a
`)
  assert.equal(questions.length, 0)
  assert.equal(errors.length, 5)
  assert.match(errors[0], /must equal one of the C: choices/)
  assert.match(errors[1], /2 to 6/)
  assert.match(errors[2], /2 to 6/)
  assert.match(errors[3], /K: shown/)
  assert.match(errors[4], /K: must be read, shown or closest/)
})

test('S: lines are one performed script, kept beside the fragments', () => {
  const { questions, errors } = parsePack(`Plain one. / Plain two.
S: [curious] Plain ONE...
S: and get this — plain twooo!
A: x`)
  assert.deepEqual(errors, [])
  assert.deepEqual(questions[0].fragments, ['Plain one.', 'Plain two.'])
  assert.equal(questions[0].script, '[curious] Plain ONE... and get this — plain twooo!')
})

test('K: closest takes a numeric A:, commas allowed, and an optional unit', () => {
  const { questions, errors } = parsePack(`V: 200
K: closest
U: steps
How many steps are in the Eiffel Tower?
A: 1,665

K: closest
In what year did the Berlin Wall fall?
A: 1989
`)
  assert.deepEqual(errors, [])
  assert.equal(questions[0].kind, 'closest')
  assert.equal(questions[0].truth, 1665)
  assert.equal(questions[0].unit, 'steps')
  assert.equal(questions[0].answer, '1,665', 'the display answer keeps the pack spelling')
  assert.equal(questions[1].truth, 1989)
  assert.equal(questions[1].unit, undefined)
  assert.equal(questions[1].plain, true, 'a year written without a comma keeps none')
  assert.equal(questions[0].plain, undefined)
})

test('a closest question refuses a non-numeric A:, a C: line, and a U: line needs K: closest', () => {
  const { questions, errors } = parsePack(`K: closest
Q one.
A: about a thousand

K: closest
C: 1 | 2
Q two.
A: 1

K: closest
Q three.
A: -4

K: closest
Q 3b.
A: 1e3

U: metres
Q four.
A: 4
`)
  assert.equal(questions.length, 0)
  assert.equal(errors.length, 5)
  assert.match(errors[0], /must be a number/)
  assert.match(errors[1], /no C: line/)
  assert.match(errors[2], /must be a number/)
  assert.match(errors[3], /must be a number/)
  assert.match(errors[4], /U: line belongs to a K: closest/)
})
