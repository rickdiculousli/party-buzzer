import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ARM_DELAY_MS, isMinigameId } from '../shared/protocol.ts'
import { knownModule, moduleFor, sanitizeOptions } from './modes/index.ts'
import { executeGrants } from './items.ts'
import { duelOnArm, duelOnWrong, duelRule, resolveDuel, seatDuel } from './duel.ts'
import { advanceSetlist, applySetup, enterBlock, introduceBlock, sanitizeBlocks } from './setlist.ts'
import { refuses } from '../shared/legality.ts'
import { persistedSnapshot } from './snapshot.ts'
import { bump, closestAwards, closestOff, leaderValue, resumeReveal, scoreKey } from '../shared/scoring.ts'
import { arrivalBlocksPlay, endLobby } from '../shared/arrival.ts'

export { bump, scoreKey, lockedPlayerIds } from '../shared/scoring.ts'
export { buzzBlockReason } from './eligibility.ts'
import type {
  SetlistBlock, HostAction, State, ActionResult,
} from '../shared/protocol.ts'

export { ARM_DELAY_MS }

const knownGame = (id: string) => knownModule(id) || isMinigameId(id)

const secs = (n: number, fallback: number): number =>
  Number.isFinite(n) ? Math.min(60, Math.max(0, Math.round(n * 10) / 10)) : fallback

export function newState(): State {
  return {
    grouping: 'solo',
    night: { facts: [] },
    readingActive: false,
    players: [],
    teams: [],
    scores: {},
    game: { id: 'trivia', options: {}, moduleState: {} },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    setlists: [],
    packs: [],
    packSizes: {},
    packCost: {},
    mirrorFragments: false,
    answerWindowSec: 10,
    choiceSec: 20,
    revealSec: 10,
    autoplay: { on: false, nextSec: 5, buzzSec: 10, reboundSec: 4, introSec: 12 },
    round: {
      questionId: '',
      attemptId: '',
      value: 100,
      phase: 'IDLE',
      armedAt: 0,
      order: [],
      total: 0,
      lockedOut: [],
    },
  }
}

function sameSetup(a: SetlistBlock, b: SetlistBlock): boolean {
  if (a.game !== b.game || a.value !== b.value) return false
  const ak = Object.keys(a.options)
  const bk = Object.keys(b.options)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a.options[k] === b.options[k])
}

function openRebound(state: State): void {
  const round = state.round
  delete round.held
  round.phase = 'ARMED'
  round.attemptId = randomUUID()
  round.armedAt = Date.now() + ARM_DELAY_MS
  round.order = []
  round.total = 0
  if (round.reveal) round.reveal = resumeReveal(round.reveal, round.armedAt)
  for (const e of state.effects) e.attemptId = round.attemptId
}

function forgetQuestion(round: State['round']): void {
  round.questionId = ''
  round.attemptId = ''
  round.armedAt = 0
  round.order = []
  round.total = 0
  round.lockedOut = []
  clearQuestion(round)
}

function clearQuestion(round: State['round']): void {
  delete round.award
  delete round.held
  delete round.fragments
  delete round.whole
  delete round.image
  delete round.answer
  delete round.kind
  delete round.choices
  delete round.closesAt
  delete round.picks
  delete round.correct
  delete round.guessing
  delete round.guesses
  delete round.truth
  delete round.paid
  delete round.nearest
  delete round.guessed
  delete round.reveal
}

function dropQuestion(state: State): void {
  forgetQuestion(state.round)
  delete state.typed
  delete state.round.judge
  delete state.round.spoken
  delete state.round.buzzable
}

function dropIntroduction(state: State): void {
  if (arrivalBlocksPlay(state)) delete state.arrival
}

export function applyHostAction(state: State, action: HostAction): ActionResult {
  const reason = refuses(state, action)
  if (reason) return { status: 'refused', reason }
  if (action.a === 'setMode' && !knownModule(action.id)) {
    return { status: 'refused', reason: 'unknown-mode' }
  }
  if (action.a === 'openDuel' && !duelRule(action.rule)) {
    return { status: 'refused', reason: 'unknown-duel-rule' }
  }
  const before = structuredClone(state)
  mutateHostAction(state, action)
  return { status: isDeepStrictEqual(before, state) ? 'unchanged' : 'applied' }
}

function mutateHostAction(state: State, action: HostAction): void {
  const round = state.round
  const leader = round.order[0]
  const apply = (a: HostAction) => applyHostAction(state, a)

  switch (action.a) {
    case 'arm': {
      round.questionId = randomUUID()
      round.attemptId = randomUUID()
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_DELAY_MS
      round.order = []
      round.total = 0
      clearQuestion(round)
      if (action.kind) round.kind = action.kind
      if (action.kind === 'reveal') {
        round.reveal = { from: round.armedAt, until: round.armedAt + state.revealSec * 1000 }
      }
      delete round.judge
      delete round.spoken
      delete round.buzzable
      state.effects = state.effects.filter((e) => e.attemptId === undefined)
      for (const e of state.effects) e.attemptId = round.attemptId
      moduleFor(state.game.id).onArm?.(state)
      duelOnArm(state)
      endLobby(state)
      return
    }

    case 'correct': {
      const mod = moduleFor(state.game.id)
      if (mod.onCorrect) {
        mod.onCorrect(state)
      } else {
        const points = leaderValue(round)
        bump(state, scoreKey(state, leader.playerId), points)
        round.award = { name: leader.name, points }
      }
      round.phase = 'IDLE'
      round.lockedOut = []
      delete round.judge
      if (mod.grants) executeGrants(state, mod.grants(state))
      return
    }

    case 'wrong': {
      const key = scoreKey(state, leader.playerId)
      const mod = moduleFor(state.game.id)
      delete round.award
      delete round.held
      if (round.reveal) round.reveal = { ...round.reveal, heldAt: leader.at }
      if (mod.onWrong) {
        mod.onWrong(state, action.neg)
      } else {
        if (action.neg) bump(state, key, -action.neg)
        if (!round.lockedOut.includes(key)) round.lockedOut.push(key)
        round.award = { name: leader.name, points: -action.neg, penalty: true }
      }
      delete round.judge
      round.order = []
      round.total = 0

      if (state.autoplay.on && state.readingActive) round.held = true
      else openRebound(state)
      duelOnWrong(state, leader.playerId)
      return
    }

    case 'timeUp':
      round.phase = 'IDLE'
      round.lockedOut = []
      return

    case 'rebound':
      delete round.spoken
      openRebound(state)
      return

    case 'next':
    case 'resetRound': {
      const played = round.armedAt > 0
      round.phase = 'IDLE'
      dropQuestion(state)
      delete state.duel
      dropIntroduction(state)
      if (action.a === 'next' && played) advanceSetlist(state, apply, Date.now())
      return
    }

    case 'undo':
      return

    case 'prepareMinigame':
    case 'startMinigame':
    case 'cancelMinigame':
    case 'closeMinigame':
      return

    case 'openLobby':
      return

    case 'closeArrival':
      delete state.arrival
      return

    case 'setMode': {
      if (state.duel && !state.duel.seated) delete state.duel
      const mod = moduleFor(action.id)
      const options = sanitizeOptions(mod.options, action.options)
      if (action.id === state.game.id) {
        state.game.options = options
        return
      }
      state.game = { id: mod.id, options, moduleState: mod.init(options) }
      if (!action.keepScores) state.scores = {}
      state.items = {}
      state.effects = []
      forgetQuestion(round)
      return
    }

    case 'setValue':
      round.value = action.value
      return

    case 'settleChoice':
      for (const [playerId, pick] of Object.entries(round.picks ?? {})) {
        if (pick === action.correct) bump(state, scoreKey(state, playerId), round.value)
      }
      round.correct = action.correct
      round.phase = 'IDLE'
      return

    case 'settleClosest': {
      const paid = closestAwards(round.guesses ?? {}, action.truth, round.value)
      for (const [playerId, points] of Object.entries(paid)) bump(state, scoreKey(state, playerId), points)
      round.truth = action.truth
      round.paid = paid
      const offs = Object.values(round.guesses ?? {}).map((g) => closestOff(g, action.truth))
      if (offs.length) round.nearest = Math.min(...offs)
      round.guessed = offs.length
      round.phase = 'IDLE'
      return
    }

    case 'setChoiceTime':
      state.choiceSec = Math.min(120, Math.max(5, Math.round(action.sec) || 20))
      return

    case 'setRevealTime':
      state.revealSec = Math.min(60, Math.max(3, Math.round(action.sec) || 10))
      return

    case 'setAnswerWindow':
      state.answerWindowSec = Math.min(120, Math.max(0, Math.round(action.sec) || 0))
      return

    case 'setScore':
      state.scores[action.key] = action.score
      return

    case 'clearNight':
      state.night = { facts: [] }
      return

    case 'rename': {
      const player = state.players.find((p) => p.id === action.playerId)
      if (player) player.name = action.name
      return
    }

    case 'kick':
      state.players = state.players.filter((p) => p.id !== action.playerId)
      delete state.scores[action.playerId]
      if (state.arrival?.kind === 'lobby') {
        state.arrival.testedPlayerIds = state.arrival.testedPlayerIds.filter((id) => id !== action.playerId)
      }
      return

    case 'setGrouping':
      state.grouping = action.grouping
      if (state.duel && !state.duel.seated) delete state.duel
      return

    case 'setMirror':
      state.mirrorFragments = action.on
      return

    case 'setAutoplay':
      state.autoplay = {
        on: action.on,
        nextSec: secs(action.nextSec, 5),
        buzzSec: secs(action.buzzSec, 10),
        reboundSec: secs(action.reboundSec, 4),
        introSec: secs(action.introSec, 12),
      }
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

    case 'openDuel': {
      const rule = duelRule(action.rule)
      if (!rule) return
      state.duel = { rule: rule.id, pool: [], missed: [] }
      endLobby(state)
      if (rule.entry === 'none' && rule.resolve === 'random') {
        const pair = resolveDuel(state, state.duel)
        if (pair) state.duel.seated = pair
        else delete state.duel
      }
      return
    }

    case 'closeDuel': {
      const duel = state.duel
      if (!duel) return
      if (action.playerIds) {
        seatDuel(state, action.playerIds)
        return
      }
      const pair = resolveDuel(state, duel)
      if (pair) duel.seated = pair
      return
    }

    case 'cancelDuel':
      delete state.duel
      delete round.buzzable
      return

    case 'setSetlist': {
      const blocks = sanitizeBlocks(action.blocks, knownGame, (id) => !!duelRule(id))
      if (blocks.length === 0) {
        delete state.setlist
        dropIntroduction(state)
        return
      }
      const prev = state.setlist
      const keep = prev && prev.at < prev.blocks.length && prev.at < blocks.length
      const at = keep ? prev.at : 0
      const done = keep ? Math.min(prev.done, blocks[at].count - 1) : 0
      const changed = keep && !sameSetup(prev.blocks[at], blocks[at])
      state.setlist = { blocks, at, done }
      if (!keep) {
        forgetQuestion(round)
        enterBlock(state, apply, true, Date.now())
        introduceBlock(state, true)
      } else if (changed) applySetup(state, apply)
      return
    }

    case 'setlistJump': {
      const setlist = state.setlist
      if (!setlist) return
      const at = Number.isFinite(action.at) ? Math.round(action.at) : 0
      setlist.at = Math.min(Math.max(0, at), setlist.blocks.length)
      setlist.done = 0
      dropIntroduction(state)
      if (setlist.at >= setlist.blocks.length) dropQuestion(state)
      enterBlock(state, apply, true, Date.now())
      introduceBlock(state, false)
      return
    }

    case 'clearSetlist':
      delete state.setlist
      dropIntroduction(state)
      return
  }
}

const queued = new Map<string, { timer: NodeJS.Timeout; snapshot: string }>()

function write(path: string): void {
  const entry = queued.get(path)
  if (!entry) return
  clearTimeout(entry.timer)
  try {
    writeFileSync(path, entry.snapshot)
  } catch (err) {
    console.error('[state] snapshot failed:', err)
  }
  queued.delete(path)
}

export function saveState(path: string, state: State): void {
  const snapshot = JSON.stringify(persistedSnapshot(state))
  const entry = queued.get(path)
  if (entry) {
    entry.snapshot = snapshot
    return
  }
  const timer = setTimeout(() => write(path), 100)
  timer.unref?.()
  queued.set(path, { timer, snapshot })
}

export function flushSave(): void {
  for (const path of queued.keys()) write(path)
}

export function loadState(path: string): State {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return newState()
  }

  try {
    const parsed = JSON.parse(raw)
    if ('version' in parsed && parsed.version !== 1 && parsed.version !== 2) throw new Error('Unsupported snapshot version')
    const loaded = { ...newState(), ...('version' in parsed ? parsed.state : parsed) } as State
    if (!Array.isArray(loaded.night?.facts)) loaded.night = { facts: [] }
    loaded.items ??= {}
    loaded.effects ??= []
    loaded.duelRules ??= []
    if (!Array.isArray(loaded.setlists)) loaded.setlists = []
    if (loaded.setlist) {
      loaded.setlist.blocks = sanitizeBlocks(loaded.setlist.blocks, knownGame, (id) => !!duelRule(id))
      if (loaded.setlist.blocks.length === 0) delete loaded.setlist
      else {
        loaded.setlist.at = Math.min(Math.max(0, loaded.setlist.at | 0), loaded.setlist.blocks.length)
        loaded.setlist.done = Math.max(0, loaded.setlist.done | 0)
        if (!Number.isFinite(loaded.setlist.spentAt)) delete loaded.setlist.spentAt
      }
    }
    if (loaded.minigame?.lobby) loaded.minigame.lobby.ready ??= []
    delete loaded.duel
    delete loaded.round.buzzable
    delete loaded.arrival
    if (!Array.isArray(loaded.packs)) loaded.packs = []
    if (typeof loaded.mirrorFragments !== 'boolean') loaded.mirrorFragments = false
    if (typeof loaded.answerWindowSec !== 'number') loaded.answerWindowSec = 10
    if (typeof loaded.choiceSec !== 'number') loaded.choiceSec = 20
    if (typeof loaded.revealSec !== 'number') loaded.revealSec = 10
    const auto = loaded.autoplay as Partial<State['autoplay']> | undefined
    loaded.autoplay = {
      on: auto?.on === true,
      nextSec: secs(Number(auto?.nextSec), 5),
      buzzSec: secs(Number(auto?.buzzSec), 10),
      reboundSec: secs(Number(auto?.reboundSec), 4),
      introSec: secs(Number(auto?.introSec), 12),
    }
    loaded.game ??= { id: 'trivia', options: {}, moduleState: {} }
    if (!knownModule(loaded.game.id)) {
      console.error(
        `[state] game "${loaded.game.id}" is not registered — falling back to trivia`,
      )
      loaded.game = { id: 'trivia', options: {}, moduleState: {} }
    }
    for (const p of loaded.players) p.connected = false
    loaded.round = { ...newState().round, value: loaded.round.value }
    loaded.effects = loaded.effects.filter((e) => e.attemptId === undefined && !('roundArmedAt' in e))
    const mod = moduleFor(loaded.game.id)
    loaded.game.options = sanitizeOptions(mod.options, loaded.game.options)
    loaded.game.moduleState = mod.init(loaded.game.options)
    loaded.games = []
    loaded.duelRules = []
    loaded.packs = []
    loaded.packSizes = {}
    loaded.packCost = {}
    loaded.setlists = []
    loaded.readingActive = false
    delete loaded.reading
    return loaded
  } catch (err) {
    console.error('[state] snapshot unreadable, starting fresh:', err)
    return newState()
  }
}
