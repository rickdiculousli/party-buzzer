import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ARM_LEAD_MS } from '../shared/protocol.ts'
import type {
  HostAction, PlayerId, ScoreKey, State,
} from '../shared/protocol.ts'

export { ARM_LEAD_MS }

export function newState(): State {
  return {
    mode: 'solo',
    players: [],
    teams: [],
    scores: {},
    round: {
      value: 100,
      phase: 'IDLE',
      armedAt: 0,
      order: [],
      late: [],
      total: 0,
      lockedOut: [],
    },
  }
}

/** Scores attach to the team in teams mode, otherwise to the player. */
export function scoreKey(state: State, playerId: PlayerId): ScoreKey {
  const player = state.players.find((p) => p.id === playerId)
  if (state.mode === 'teams' && player?.teamId) return player.teamId
  return playerId
}

/** Expand the round's locked-out score keys into the player ids they bar. */
export function lockedPlayerIds(state: State): PlayerId[] {
  const barred = new Set(state.round.lockedOut)
  return state.players
    .filter((p) => barred.has(scoreKey(state, p.id)))
    .map((p) => p.id)
}

function bump(state: State, key: ScoreKey, delta: number): void {
  state.scores[key] = (state.scores[key] ?? 0) + delta
}

export function applyHostAction(state: State, action: HostAction): void {
  const round = state.round
  const leader = round.order[0]

  switch (action.a) {
    case 'arm':
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.late = []
      round.total = 0
      delete round.award
      return

    case 'correct':
      if (!leader) return
      bump(state, scoreKey(state, leader.playerId), round.value)
      // The order stays up. Clearing it here is what made the result vanish at
      // the exact moment the room looked at it; `arm` and `next` clear it.
      round.phase = 'IDLE'
      round.lockedOut = []
      round.award = { name: leader.name, points: round.value }
      return

    case 'wrong': {
      if (!leader) return
      const key = scoreKey(state, leader.playerId)
      if (action.neg) bump(state, key, -action.neg)
      if (!round.lockedOut.includes(key)) round.lockedOut.push(key)
      // Rebound: reopen the buzzers for everyone not locked out.
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.late = []
      round.total = 0
      delete round.award
      return
    }

    case 'next':
    case 'resetRound':
      round.phase = 'IDLE'
      round.armedAt = 0
      round.order = []
      round.late = []
      round.total = 0
      round.lockedOut = []
      delete round.award
      return

    case 'undo':
      // Handled by the hub, which owns the snapshot stack.
      return

    case 'setValue':
      round.value = action.value
      return

    case 'setScore':
      state.scores[action.key] = action.score
      return

    case 'rename': {
      const player = state.players.find((p) => p.id === action.playerId)
      if (player) player.name = action.name
      return
    }

    case 'kick':
      state.players = state.players.filter((p) => p.id !== action.playerId)
      delete state.scores[action.playerId]
      return

    case 'setMode':
      state.mode = action.mode
      return

    case 'addTeam': {
      const team = { id: randomUUID(), name: action.name, color: action.color }
      state.teams.push(team)
      state.scores[team.id] ??= 0
      return
    }

    case 'assign': {
      const player = state.players.find((p) => p.id === action.playerId)
      if (!player) return
      player.teamId = action.teamId
      if (action.teamId) state.scores[action.teamId] ??= 0
      return
    }
  }
}

// ponytail: rewrites the whole file on every change, debounced. State is a few
// KB and writes are rare, so this stays well under a millisecond. Switch to an
// append-only log only if a game ever grows large enough to stutter.
let pending: NodeJS.Timeout | undefined
let queued: { path: string; snapshot: string } | undefined

function write(): void {
  pending = undefined
  if (!queued) return
  try {
    writeFileSync(queued.path, queued.snapshot)
  } catch (err) {
    // A failed snapshot must never take the game down mid-question.
    console.error('[state] snapshot failed:', err)
  }
  queued = undefined
}

/**
 * Coalescing write. The first change schedules the flush and later ones only
 * replace what gets written, so a burst costs one write and never pushes the
 * deadline back — a game that keeps changing still gets saved.
 */
export function saveState(path: string, state: State): void {
  queued = { path, snapshot: JSON.stringify(state) }
  if (pending) return
  pending = setTimeout(write, 100)
  pending.unref?.()
}

/** Write anything outstanding right now. Sync, so shutdown cannot wait on it. */
export function flushSave(): void {
  clearTimeout(pending)
  write()
}

export function loadState(path: string): State {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return newState()
  }

  try {
    const loaded = JSON.parse(raw) as State
    // Nobody is connected yet; sockets re-establish that on their own.
    for (const p of loaded.players) p.connected = false
    // A round mid-flight can't survive a restart: no timer, no pending buzzes.
    loaded.round.phase = 'IDLE'
    loaded.round.order = []
    loaded.round.late = []
    loaded.round.total = 0
    delete loaded.round.award
    return loaded
  } catch (err) {
    console.error('[state] snapshot unreadable, starting fresh:', err)
    return newState()
  }
}
