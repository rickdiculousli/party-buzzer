import test from 'node:test'
import assert from 'node:assert/strict'
import type { MinigameFrame } from '../shared/protocol.ts'
import { MINIGAME_INFO, matchFrame } from './minigame-info.ts'
import { MINIGAMES } from '../server/minigames/registry.ts'

test('the host clock wording follows the server definition', () => {
  for (const [id, info] of Object.entries(MINIGAME_INFO)) {
    assert.equal(info.timed, !MINIGAMES[id as keyof typeof MINIGAMES].untimed, id)
  }
})

test('a frame from another match, game, or role is not drawn', () => {
  const frame = { id: 'ink', role: 'board', matchId: 'm1', tick: 0 } as unknown as MinigameFrame
  assert.equal(matchFrame(frame, 'ink', 'board', 'm1'), frame)
  assert.equal(matchFrame(frame, 'ink', 'board', 'm2'), null)
  assert.equal(matchFrame(frame, 'bow', 'board', 'm1'), null)
  assert.equal(matchFrame(frame, 'ink', 'player', 'm1'), null)
  assert.equal(matchFrame(null, 'ink', 'board', 'm1'), null)
})
