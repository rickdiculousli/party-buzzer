import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import { gameSnapshot, persistedSnapshot, restoreGame } from './snapshot.ts'
import type { State } from '../shared/protocol.ts'

/**
 * Every `State` field's lifetime, in one place. A new field fails here by name
 * until it has a row; changing a row is the deliberate decision AGENTS.md asks for.
 *
 * undo  yes:  in `gameSnapshot`, so an undo returns it.
 *       live: left out, and the current value survives an undo (catalogs).
 *       no:   left out, and an undo clears or resets it (playback).
 * disk  yes:  written to `persistedSnapshot` unchanged.
 *       reset: written in a narrowed or rewound form (round value only, a reset match).
 *       no:   not written; a restart rebuilds or forgets it.
 * phone full: a player's `viewFor` carries what the host's does.
 *       own:  a player gets a projection of its own (redacted to their share).
 *       none: a player never gets it.
 *
 * A row describes the fixture below. Some fields vary by shape: a lobby
 * `arrival` is dropped from undo, and a `minigame` in ready or results is
 * written to disk unchanged. snapshot.test.ts covers those cases.
 */
type Lifetime = { undo: 'yes' | 'no' | 'live'; disk: 'yes' | 'no' | 'reset'; phone: 'full' | 'own' | 'none' }

const lifetimes = {
  grouping: { undo: 'yes', disk: 'yes', phone: 'full' },
  players: { undo: 'yes', disk: 'reset', phone: 'full' },
  teams: { undo: 'yes', disk: 'yes', phone: 'full' },
  scores: { undo: 'yes', disk: 'yes', phone: 'full' },
  round: { undo: 'yes', disk: 'reset', phone: 'own' },
  game: { undo: 'yes', disk: 'reset', phone: 'own' },
  items: { undo: 'yes', disk: 'yes', phone: 'full' },
  effects: { undo: 'yes', disk: 'reset', phone: 'full' },
  games: { undo: 'live', disk: 'no', phone: 'full' },
  duel: { undo: 'yes', disk: 'no', phone: 'full' },
  duelRules: { undo: 'live', disk: 'no', phone: 'full' },
  setlist: { undo: 'yes', disk: 'yes', phone: 'full' },
  setlists: { undo: 'live', disk: 'no', phone: 'full' },
  packs: { undo: 'live', disk: 'no', phone: 'full' },
  packSizes: { undo: 'live', disk: 'no', phone: 'full' },
  packCost: { undo: 'live', disk: 'no', phone: 'full' },
  mirrorFragments: { undo: 'yes', disk: 'yes', phone: 'full' },
  answerWindowSec: { undo: 'yes', disk: 'yes', phone: 'full' },
  choiceSec: { undo: 'yes', disk: 'yes', phone: 'full' },
  autoplay: { undo: 'yes', disk: 'yes', phone: 'full' },
  readingActive: { undo: 'no', disk: 'no', phone: 'full' },
  reading: { undo: 'no', disk: 'no', phone: 'none' },
  minigame: { undo: 'yes', disk: 'reset', phone: 'full' },
  arrival: { undo: 'yes', disk: 'no', phone: 'full' },
  night: { undo: 'yes', disk: 'yes', phone: 'none' },
} satisfies Record<keyof State, Lifetime> as Record<keyof State, Lifetime>

/** A state with every optional field present (the table's type catches one this misses) and something in each to redact or reset. */
function everyField(): State {
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }, { id: 'b', name: 'Bo', connected: true }]
  state.scores = { a: 300, b: 100 }
  state.items = { a: ['steal'] }
  state.effects = [{ kind: 'frozen', playerId: 'b' }, { kind: 'steal', playerId: 'a', attemptId: 'att' }]
  state.games = [{ id: 'trivia' } as State['games'][number]]
  state.duelRules = [{ id: 'vote' } as State['duelRules'][number]]
  state.packs = ['one.txt']
  state.packSizes = { 'one.txt': 3 }
  state.packCost = { 'one.txt': 0 }
  state.setlists = ['night.json']
  state.round = {
    ...state.round,
    questionId: 'q',
    attemptId: 'att',
    phase: 'LOCKED',
    order: [{ playerId: 'b', name: 'Bo', at: 1, deltaMs: 0 }, { playerId: 'a', name: 'Ada', at: 2, deltaMs: 1 }],
    total: 2,
    whole: 'the unspoken remainder',
    judge: {},
  }
  state.duel = { rule: 'vote', pool: [{ playerId: 'a', votes: [], in: true }], missed: [] }
  state.setlist = { blocks: [{ game: 'trivia', options: {}, count: 2 }], at: 0, done: 1 }
  state.readingActive = true
  state.reading = { pack: 'one.txt', qIndex: 1, qTotal: 3, fragIndex: 2, fragTotal: 5, paused: false }
  state.minigame = {
    id: 'poker',
    matchId: 'm',
    phase: 'playing',
    options: { durationSec: 60, seed: 1 },
    participants: ['a', 'b'],
    startsAt: 1,
    endsAt: 2,
    checkpoint: { version: 1, label: 'Hand 3', data: { deckSeed: 42 } },
  }
  state.arrival = { kind: 'introduction', id: 'arr', blockAt: 0, blockKey: 'k' }
  state.night = {
    facts: [{
      kind: 'verdict', at: 1, questionId: 'q', playerId: 'a', key: 'a', name: 'Ada',
      points: 100, hit: true, source: 'buzz', reactionMs: 300,
    }],
  }
  return state
}

const keysWhere = (pick: (l: Lifetime) => boolean) =>
  (Object.keys(lifetimes) as (keyof State)[]).filter((k) => pick(lifetimes[k])).sort()

/** The field names written in `State`'s declaration, so an unset optional one still counts. */
function declaredFields(): string[] {
  const source = readFileSync(new URL('../shared/protocol.ts', import.meta.url), 'utf8')
  const body = source.split('\nexport type State = {\n')[1]!.split('\n}\n')[0]!
  return [...body.matchAll(/^  (\w+)\??:/gm)].map((m) => m[1]!).sort()
}

test('every State field has a lifetime row, and every row names a field', () => {
  const declared = declaredFields()
  const unclassified = declared.filter((k) => !(k in lifetimes))
  assert.deepEqual(unclassified, [], `classify in server/lifetimes.test.ts: ${unclassified.join(', ')}`)
  assert.deepEqual(Object.keys(lifetimes).sort(), declared, 'a row names a field State does not declare')
  assert.deepEqual(Object.keys(everyField()).sort(), declared, 'everyField() must set every field')
})

test('undo keeps exactly the undo: yes fields; live ones survive and the rest reset', () => {
  const state = everyField()
  const snapshot = gameSnapshot(state)
  assert.deepEqual(Object.keys(snapshot).sort(), keysWhere((l) => l.undo === 'yes'))
  const before = structuredClone(state)
  restoreGame(state, snapshot)
  for (const key of keysWhere((l) => l.undo === 'live')) {
    assert.deepEqual(state[key], before[key], `${key} is live across undo`)
  }
  for (const key of keysWhere((l) => l.undo === 'no')) {
    assert.notDeepEqual(state[key], before[key], `${key} is reset by undo`)
  }
})

test('disk keeps exactly the disk: yes and reset fields, the yes ones unchanged', () => {
  const state = everyField()
  const disk = persistedSnapshot(state).state as Record<string, unknown>
  assert.deepEqual(Object.keys(disk).sort(), keysWhere((l) => l.disk !== 'no'))
  for (const key of keysWhere((l) => l.disk === 'yes')) {
    assert.deepEqual(disk[key], state[key], `${key} is written unchanged`)
  }
  for (const key of keysWhere((l) => l.disk === 'reset')) {
    assert.notDeepEqual(disk[key], state[key], `${key} is written reset`)
  }
})

test('a phone sees full fields as the host does, its own projection of others, and none of the rest', () => {
  const hub = new Hub(everyField())
  const phone: Conn = { id: 'pa', role: 'player', playerId: 'a', send() {} }
  const view = hub.viewFor(phone) as Record<string, unknown>
  const host = hub.viewFor({ id: 'h', role: 'host', send() {} }) as Record<string, unknown>
  for (const key of keysWhere((l) => l.phone === 'none')) {
    assert.equal(view[key], undefined, `${key} never reaches a phone`)
  }
  for (const key of keysWhere((l) => l.phone === 'full')) {
    assert.notEqual(host[key], undefined, `${key} is in the fixture`)
    assert.deepEqual(view[key], host[key], `${key} reaches a phone as the host sees it`)
  }
  for (const key of keysWhere((l) => l.phone === 'own')) {
    assert.notEqual(view[key], undefined, `${key} reaches a phone`)
    assert.notDeepEqual(view[key], host[key], `${key} is projected for a phone`)
  }
})
