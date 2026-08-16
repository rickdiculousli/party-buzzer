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
