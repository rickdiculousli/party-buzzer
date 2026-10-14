import test from 'node:test'
import assert from 'node:assert/strict'
import { milestoneFor, milestones, nightKeepsake, recapCards, setlistSpent, type RecapCard } from './recap.ts'
import type { Night, NightFact, State } from './protocol.ts'
import { newState } from '../server/state.ts'

type Roster = Pick<State, 'players' | 'teams' | 'grouping' | 'scores'>

const NAMES: Record<string, string> = { a: 'Ada', b: 'Bo', c: 'Cy', d: 'Dee', e: 'Eve', f: 'Fay' }
const roster = (ids = ['a', 'b', 'c'], scores: Record<string, number> = {}): Roster => ({
  players: ids.map((id) => ({ id, name: NAMES[id]!, connected: true })),
  teams: [],
  grouping: 'solo',
  scores,
})

type V = { q: string; key: string; hit?: boolean; ms?: number; margin?: number; source?: 'buzz' | 'choice' }
const verdict = ({ q, key, hit = true, ms, margin, source = 'buzz' }: V): NightFact => ({
  kind: 'verdict', at: 0, questionId: q, playerId: key, key, name: NAMES[key] ?? key,
  points: hit ? 100 : -100, hit, source, reactionMs: ms, marginMs: margin,
})
const standings = (keys: string[], at: { questionId?: string; matchId?: string } = {}): NightFact => ({
  kind: 'standings', at: 0, ...at, order: keys.map((key, i) => ({ key, score: 1000 - i * 100 })),
})
const night = (...facts: NightFact[]): Night => ({ facts })
const card = (cards: RecapCard[], id: string) => cards.find((c) => c.id === id)

test('fastest buzz counts misses too, carries its margin, and joins a tie', () => {
  const r = roster()
  const cards = recapCards(night(
    verdict({ q: '1', key: 'a', ms: 300, margin: 50 }),
    verdict({ q: '2', key: 'b', hit: false, ms: 120, margin: 80 }),
    verdict({ q: '3', key: 'c', ms: 200 }),
  ), r)
  assert.deepEqual(card(cards, 'fastest'), { id: 'fastest', title: 'Fastest buzz', name: 'Bo', detail: '120 ms · 80 ms ahead' })
  const tied = recapCards(night(verdict({ q: '1', key: 'a', ms: 90 }), verdict({ q: '2', key: 'c', ms: 90 })), r)
  assert.deepEqual(card(tied, 'fastest'), { id: 'fastest', title: 'Fastest buzz', name: 'Ada & Cy', detail: '90 ms' })
})

test('choice verdicts have no reaction to be fastest with', () => {
  assert.equal(card(recapCards(night(verdict({ q: '1', key: 'a', source: 'choice' })), roster()), 'fastest'), undefined)
})

test('longest streak: someone else answering breaks a run, minigame facts do not', () => {
  const r = roster()
  const minigame: NightFact = { kind: 'minigame', at: 0, id: 'bow', matchId: 'm', results: [{ playerId: 'b', key: 'b', name: 'Bo', points: 10 }] }
  const cards = recapCards(night(
    verdict({ q: '1', key: 'a' }), verdict({ q: '2', key: 'a' }), minigame, verdict({ q: '3', key: 'a' }),
    verdict({ q: '4', key: 'b' }),
    verdict({ q: '5', key: 'a' }), verdict({ q: '6', key: 'a' }),
  ), r)
  assert.equal(card(cards, 'streak')?.name, 'Ada')
  assert.equal(card(cards, 'streak')?.detail, '3 in a row')
  const broken = recapCards(night(verdict({ q: '1', key: 'a' }), verdict({ q: '2', key: 'b' }), verdict({ q: '3', key: 'a' })), r)
  assert.equal(card(broken, 'streak'), undefined, 'no run of two')
})

test('a miss then another player\'s hit breaks the misser\'s run', () => {
  const cards = recapCards(night(
    verdict({ q: '1', key: 'a' }), verdict({ q: '2', key: 'a', hit: false }), verdict({ q: '2', key: 'b' }), verdict({ q: '3', key: 'a' }),
  ), roster())
  assert.equal(card(cards, 'streak'), undefined)
})

test('most first buzzes needs two, counts the first buzz verdict per question, and joins a tie', () => {
  const r = roster()
  const cards = recapCards(night(
    verdict({ q: '1', key: 'a', hit: false }), verdict({ q: '1', key: 'b' }),
    verdict({ q: '2', key: 'a' }),
    verdict({ q: '3', key: 'b' }), verdict({ q: '4', key: 'b' }),
  ), r)
  assert.deepEqual(card(cards, 'first-buzzes'), { id: 'first-buzzes', title: 'Most first buzzes', name: 'Ada & Bo', detail: 'first to buzz 2 times' })
  assert.equal(card(recapCards(night(verdict({ q: '1', key: 'a' }), verdict({ q: '2', key: 'b' })), r), 'first-buzzes'), undefined)
})

test('comeback: bottom half to the podium, once per key, and only with four keys', () => {
  const r = roster(['a', 'b', 'c', 'd', 'e', 'f'])
  const facts = night(
    standings(['a', 'b', 'c', 'd', 'e', 'f']),
    standings(['a', 'b', 'f', 'c', 'd', 'e'], { questionId: 'q1' }),
    standings(['f', 'a', 'b', 'c', 'd', 'e'], { questionId: 'q2' }),
  )
  const found = milestones(facts, r).filter((m) => m.kind === 'comeback')
  assert.deepEqual(found.map((m) => m.text), ['Comeback: Fay, 6th to 3rd'])
  assert.equal(found[0]!.questionId, 'q1')
  assert.deepEqual(card(recapCards(facts, r), 'comeback-f'), { id: 'comeback-f', title: 'Comeback', name: 'Fay', detail: '6th to 3rd' })
  const small = roster(['a', 'b', 'c'])
  assert.deepEqual(milestones(night(standings(['a', 'b', 'c']), standings(['c', 'a', 'b'])), small).filter((m) => m.kind === 'comeback'), [])
})

test('a teams night labels teams and groups minigame results by team', () => {
  const r: Roster = {
    grouping: 'teams',
    players: [
      { id: 'a', name: 'Ada', teamId: 'red', connected: true },
      { id: 'b', name: 'Bo', teamId: 'red', connected: true },
      { id: 'c', name: 'Cy', teamId: 'blue', connected: true },
    ],
    teams: [{ id: 'red', name: 'Reds', color: '#f00' }, { id: 'blue', name: 'Blues', color: '#00f' }],
    scores: { red: 300, blue: 500 },
  }
  const mini: NightFact = {
    kind: 'minigame', at: 0, id: 'ink', matchId: 'm1',
    results: [
      { playerId: 'a', key: 'red', name: 'Ada', points: 30 },
      { playerId: 'b', key: 'red', name: 'Bo', points: 40 },
      { playerId: 'c', key: 'blue', name: 'Cy', points: 60 },
    ],
  }
  const cards = recapCards(night(mini), r)
  assert.deepEqual(card(cards, 'minigame-m1'), { id: 'minigame-m1', title: 'Ink', name: 'Reds', detail: '70 points' })
  assert.deepEqual(card(cards, 'closest'), { id: 'closest', title: 'Closest finish', name: 'Blues over Reds', detail: 'by 200 points' })
  const lead = milestones(night(verdict({ q: '1', key: 'red' })), r)
  assert.equal(lead[0]!.text, 'First correct: Reds')
})

test('a minigame result with place only names the first place', () => {
  const mini: NightFact = {
    kind: 'minigame', at: 0, id: 'sketch', matchId: 'm2',
    results: [
      { playerId: 'a', key: 'a', name: 'Ada', points: 0, place: 2 },
      { playerId: 'b', key: 'b', name: 'Bo', points: 0, place: 1 },
    ],
  }
  assert.deepEqual(card(recapCards(night(mini), roster()), 'minigame-m2'), { id: 'minigame-m2', title: 'Sketch', name: 'Bo', detail: '1st place' })
  assert.equal(card(recapCards(night({ ...mini, results: [] } as NightFact), roster()), 'minigame-m2'), undefined)
})

test('closest finish names a tie, and needs two keys', () => {
  assert.deepEqual(card(recapCards(night(), roster(['a', 'b'], { a: 400, b: 400 })), 'closest'), {
    id: 'closest', title: 'Closest finish', name: 'Ada & Bo', detail: 'tied at 400',
  })
  assert.equal(card(recapCards(night(), roster(['a'])), 'closest'), undefined)
})

test('milestoneFor says at most one thing per question, leader over streak, and none elsewhere', () => {
  const r = roster()
  const facts = night(
    verdict({ q: '1', key: 'a' }), standings(['a', 'b', 'c'], { questionId: '1' }),
    verdict({ q: '2', key: 'b' }), standings(['b', 'a', 'c'], { questionId: '2' }),
    verdict({ q: '3', key: 'a' }), verdict({ q: '4', key: 'a' }),
    verdict({ q: '5', key: 'a' }), standings(['a', 'b', 'c'], { questionId: '5' }),
  )
  assert.equal(milestoneFor(facts, r, { questionId: '1' }), 'First correct: Ada')
  assert.equal(milestoneFor(facts, r, { questionId: '2' }), 'New leader: Bo')
  assert.equal(milestoneFor(facts, r, { questionId: '4' }), null)
  assert.equal(milestoneFor(facts, r, { questionId: '5' }), 'New leader: Ada', 'leader outranks the three in a row on the same question')
  assert.equal(milestones(facts, r).find((m) => m.kind === 'streak')?.text, 'Three in a row: Ada')
  assert.equal(milestoneFor(facts, r, {}), null)
})

test('a tie for first is not a new leader, and a leader returns only after a unique top changes', () => {
  const tie: NightFact = { kind: 'standings', at: 0, questionId: '2', order: [{ key: 'b', score: 100 }, { key: 'a', score: 100 }] }
  const facts = night(standings(['a', 'b']), tie)
  assert.deepEqual(milestones(facts, roster(['a', 'b'])), [])
})

test('no card ever names a miss, the slowest or the lowest', () => {
  const cards = recapCards(night(
    verdict({ q: '1', key: 'a', hit: false, ms: 900, margin: 5 }),
    verdict({ q: '2', key: 'b', ms: 100 }),
  ), roster(['a', 'b'], { a: -100, b: 100 }))
  const text = JSON.stringify(cards).toLowerCase()
  for (const word of ['slowest', 'wrong', 'fewest', 'lowest', 'last']) assert.ok(!text.includes(word), word)
  assert.ok(!cards.some((c) => c.name === 'Ada' && c.id !== 'closest'))
})

test('the keepsake carries the standings, the cards and the facts', () => {
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }, { id: 'b', name: 'Bo', connected: true }]
  state.scores = { a: 100, b: 300 }
  state.night = night(verdict({ q: '1', key: 'b', ms: 150 }))
  const k = nightKeepsake(state, '2026-10-14')
  assert.equal(k.version, 1)
  assert.equal(k.date, '2026-10-14')
  assert.deepEqual(k.standings, [{ key: 'b', label: 'Bo', score: 300 }, { key: 'a', label: 'Ada', score: 100 }])
  assert.deepEqual(k.players[0], { id: 'a', name: 'Ada', teamId: undefined })
  assert.equal(k.facts.length, 1)
  assert.ok(k.cards.some((c) => c.id === 'fastest'))
})

test('setlistSpent holds once every block has been played, and never with no blocks', () => {
  const block = { game: 'trivia', options: {}, count: 1 }
  assert.equal(setlistSpent({}), false)
  assert.equal(setlistSpent({ setlist: { blocks: [], at: 0, done: 0 } }), false)
  assert.equal(setlistSpent({ setlist: { blocks: [block], at: 0, done: 0 } }), false)
  assert.equal(setlistSpent({ setlist: { blocks: [block], at: 1, done: 0 } }), true)
})
