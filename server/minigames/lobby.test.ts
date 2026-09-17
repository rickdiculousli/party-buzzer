import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLobby, lobbyStartable, teamMembers } from './lobby.ts'
import type { MinigameLobby } from '../../shared/protocol.ts'

const empty = (): MinigameLobby => ({ teams: {}, volunteers: [] })

test('joining, switching and leaving update the team and drop the volunteer mark', () => {
  const lobby = empty()
  assert.equal(applyLobby(lobby, 'ada', { do: 'join', team: 'sun' }), true)
  assert.equal(applyLobby(lobby, 'ada', { do: 'join', team: 'sun' }), false)
  assert.equal(applyLobby(lobby, 'ada', { do: 'volunteer', on: true }), true)
  assert.deepEqual(lobby.volunteers, ['ada'])
  applyLobby(lobby, 'ada', { do: 'join', team: 'moon' })
  assert.equal(lobby.teams.ada, 'moon')
  assert.deepEqual(lobby.volunteers, [])
  applyLobby(lobby, 'ada', { do: 'leave' })
  assert.equal(lobby.teams.ada, undefined)
})

test('volunteering needs a team', () => {
  const lobby = empty()
  assert.equal(applyLobby(lobby, 'ada', { do: 'volunteer', on: true }), false)
  assert.deepEqual(lobby.volunteers, [])
})

test('start needs every connected player picked and two per team', () => {
  const lobby = empty()
  const connected = ['a', 'b', 'c', 'd']
  applyLobby(lobby, 'a', { do: 'join', team: 'sun' })
  applyLobby(lobby, 'b', { do: 'join', team: 'sun' })
  applyLobby(lobby, 'c', { do: 'join', team: 'moon' })
  assert.equal(lobbyStartable(lobby, connected), 'unpicked')
  applyLobby(lobby, 'd', { do: 'join', team: 'sun' })
  assert.equal(lobbyStartable(lobby, connected), 'team-too-small')
  applyLobby(lobby, 'd', { do: 'join', team: 'moon' })
  assert.equal(lobbyStartable(lobby, connected), null)
})

test('disconnected picks do not count toward a team', () => {
  const lobby = empty()
  for (const [id, team] of [['a', 'sun'], ['b', 'sun'], ['c', 'moon'], ['gone', 'moon']] as const) {
    applyLobby(lobby, id, { do: 'join', team })
  }
  assert.deepEqual(teamMembers(lobby, ['a', 'b', 'c'], 'moon'), ['c'])
  assert.equal(lobbyStartable(lobby, ['a', 'b', 'c']), 'team-too-small')
})
