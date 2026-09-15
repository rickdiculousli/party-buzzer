import { randomUUID } from 'node:crypto'
import type { State } from '../shared/protocol.ts'

/** Undo owns game data, not connections, catalogs, or playback. */
export function gameSnapshot(state: State) {
  const { reading, readingActive, games, duelRules, packs, packSizes, setlists, ...game } = state
  const snapshot = structuredClone(game)
  delete snapshot.round.judge
  return {
    ...snapshot,
    players: snapshot.players.map(({ connected, ...player }) => player),
  }
}

export type GameSnapshot = ReturnType<typeof gameSnapshot>

export function restoreGame(state: State, snapshot: GameSnapshot): void {
  const connected = new Map(state.players.map((p) => [p.id, p.connected]))
  // Joining is not a host action: a phone arriving after the saved action stays.
  const joined = state.players.filter((p) => !snapshot.players.some((old) => old.id === p.id))
  const scores = Object.fromEntries(joined.map((p) => [p.id, state.scores[p.id] ?? 0]))
  const restored = structuredClone(snapshot)
  const runtime = new Set(['games', 'duelRules', 'packs', 'packSizes', 'setlists'])
  for (const key of Object.keys(state)) {
    if (!runtime.has(key)) Reflect.deleteProperty(state, key)
  }
  Object.assign(state, restored, {
    players: [...restored.players.map((p) => ({ ...p, connected: connected.get(p.id) ?? false })), ...joined],
    scores: { ...restored.scores, ...scores },
    readingActive: false,
  })
  // Raw buzz packets and their timers cannot be restored. Reopen that attempt;
  // a settled leader can still be judged manually after undoing a verdict.
  if (state.round.phase === 'COLLECTING' || state.round.held) {
    state.round.phase = 'ARMED'
    state.round.order = []
    state.round.total = 0
  }
  delete state.round.held
  delete state.round.judge
  if (state.round.questionId) {
    state.round.attemptId = randomUUID()
    for (const effect of state.effects) {
      if (effect.attemptId !== undefined) effect.attemptId = state.round.attemptId
    }
  }
  if (state.minigame?.phase === 'countdown' || state.minigame?.phase === 'playing') {
    state.minigame = {
      ...state.minigame,
      matchId: randomUUID(),
      phase: 'ready',
      participants: [],
      startsAt: undefined,
      endsAt: undefined,
      results: undefined,
      crews: undefined,
    }
  }
}

/** Versioned disk data intentionally excludes the question and all runtime state. */
export function persistedSnapshot(state: State) {
  return {
    version: 1 as const,
    state: {
      grouping: state.grouping,
      players: state.players.map(({ connected, ...player }) => player),
      teams: state.teams,
      scores: state.scores,
      game: { id: state.game.id, options: state.game.options },
      items: state.items,
      effects: state.effects.filter((e) => e.attemptId === undefined),
      setlist: state.setlist,
      round: { value: state.round.value },
      mirrorFragments: state.mirrorFragments,
      answerWindowSec: state.answerWindowSec,
      autoplay: state.autoplay,
      minigame: state.minigame && (state.minigame.phase === 'ready' || state.minigame.phase === 'results')
        ? state.minigame
        : state.minigame
          ? { ...state.minigame, matchId: randomUUID(), phase: 'ready' as const, participants: [], startsAt: undefined, endsAt: undefined, results: undefined, crews: undefined }
          : undefined,
    },
  }
}
