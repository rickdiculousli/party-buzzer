import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ARM_LEAD_MS } from '../shared/protocol.ts'
import { knownModule, moduleFor, sanitizeOptions } from './modes/index.ts'
import { executeGrants } from './items.ts'
import { duelOnArm, duelOnWrong, duelRule, resolveDuel, seatDuel } from './duel.ts'
import { advanceFlow, applySetup, enterBlock, sanitizeBlocks } from './flow.ts'
import type {
  FlowBlock, HostAction, PlayerId, ScoreKey, State,
} from '../shared/protocol.ts'

export { ARM_LEAD_MS }

/** A dwell the host typed: tenths of a second, never negative, never a minute. */
const secs = (n: number, fallback: number): number =>
  Number.isFinite(n) ? Math.min(60, Math.max(0, Math.round(n * 10) / 10)) : fallback

export function newState(): State {
  return {
    mode: 'solo',
    players: [],
    teams: [],
    scores: {},
    // The default mode is trivia, which has no options and an empty module
    // state; written as a literal so newState never touches the registry.
    game: { id: 'trivia', options: {}, moduleState: {} },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    flows: [],
    packs: [],
    packSizes: {},
    mirrorFragments: false,
    // Ten seconds of silence is a stall. Only ever read by the judge, which
    // only runs while the reader drives a pack, so host-read games never feel it.
    answerWindowSec: 10,
    // Off by default: a host who has not asked for it should never find the
    // room moving on without them.
    autoplay: { on: false, nextSec: 5, reboundSec: 2 },
    round: {
      value: 100,
      phase: 'IDLE',
      armedAt: 0,
      order: [],
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

/**
 * Why a player may not buzz right now, or null. Framework effects first — a
 * frozen player is frozen in every mode — then the module's own rules.
 */
export function buzzBlockReason(state: State, playerId: PlayerId): string | null {
  const frozen = state.effects.some(
    (e) =>
      e.kind === 'frozen' &&
      e.playerId === playerId &&
      e.roundArmedAt === state.round.armedAt,
  )
  if (frozen) return 'frozen'
  return moduleFor(state.game.id).canBuzz?.(state, playerId) ?? null
}

export function bump(state: State, key: ScoreKey, delta: number): void {
  state.scores[key] = (state.scores[key] ?? 0) + delta
}

/**
 * Whether two blocks would run the room the same way. A shallow compare of
 * `options` is a corner cut — a block that swaps one option value for a
 * deep-equal-but-different object would false-negative here — but options
 * arrive from the builder's own form, which never produces that shape.
 */
function sameSetup(a: FlowBlock, b: FlowBlock): boolean {
  if (a.game !== b.game || a.value !== b.value) return false
  const ak = Object.keys(a.options)
  const bk = Object.keys(b.options)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a.options[k] === b.options[k])
}

export function applyHostAction(state: State, action: HostAction): void {
  const round = state.round
  const leader = round.order[0]
  // The flow applies its blocks through this same function: entering a block is
  // exactly the actions a host would press, so every validation still runs.
  const apply = (a: HostAction) => applyHostAction(state, a)

  switch (action.a) {
    case 'arm': {
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.total = 0
      delete round.award
      delete round.fragments
      delete round.answer
      delete round.judge
      delete round.spoken
      delete round.candidates
      // A fresh question: sweep effects stamped to the last one, stamp the
      // live ones (a freeze fired between questions lands here).
      state.effects = state.effects.filter((e) => e.roundArmedAt === undefined)
      for (const e of state.effects) e.roundArmedAt = round.armedAt
      moduleFor(state.game.id).onArm?.(state)
      duelOnArm(state)
      return
    }

    case 'correct': {
      // Judging waits for the window: a provisional leader is on the board
      // from 150ms in, but scoring during COLLECTING would strand every buzz
      // still in the air and cut the timeline the room is watching.
      if (!leader || round.phase !== 'LOCKED') return
      const mod = moduleFor(state.game.id)
      if (mod.onCorrect) {
        mod.onCorrect(state)
      } else {
        bump(state, scoreKey(state, leader.playerId), round.value)
        // The order stays up. Clearing it here is what made the result vanish
        // at the exact moment the room looked at it; `arm` and `next` clear it.
        round.award = { name: leader.name, points: round.value }
      }
      round.phase = 'IDLE'
      round.lockedOut = []
      // The window is over; the transcript stays up beside the award.
      delete round.judge
      if (mod.grants) executeGrants(state, mod.grants(state))
      return
    }

    case 'wrong': {
      if (!leader || round.phase !== 'LOCKED') return
      const key = scoreKey(state, leader.playerId)
      const mod = moduleFor(state.game.id)
      if (mod.onWrong) {
        mod.onWrong(state, action.neg)
      } else {
        if (action.neg) bump(state, key, -action.neg)
        if (!round.lockedOut.includes(key)) round.lockedOut.push(key)
      }
      // Rebound: reopen the buzzers for everyone not locked out. The question
      // is still live, so effects ride along under the new arm instant.
      round.phase = 'ARMED'
      round.armedAt = Date.now() + ARM_LEAD_MS
      round.order = []
      round.total = 0
      delete round.award
      // Same: the verdict ended the window, but what was said rides the rebound.
      delete round.judge
      for (const e of state.effects) e.roundArmedAt = round.armedAt
      duelOnWrong(state, leader.playerId)
      return
    }

    case 'next':
    case 'resetRound': {
      // Captured before the reset clears it: this is what tells a finished
      // question from a double-tap on N or a stale award being cleared.
      const played = round.armedAt > 0
      round.phase = 'IDLE'
      round.armedAt = 0
      round.order = []
      round.total = 0
      round.lockedOut = []
      delete round.award
      delete round.fragments
      delete round.answer
      delete round.judge
      delete round.spoken
      delete round.candidates
      // A duel is one question. The host re-opens (or rematches by arming
      // before next) rather than the pair leaking into the next round.
      delete state.duel
      // After the reset, never before: the block's `openDuel` needs an IDLE
      // round and a cleared duel to land on. `resetRound` is the host taking a
      // question back, so it spends nothing.
      if (action.a === 'next' && played) advanceFlow(state, apply)
      return
    }

    case 'undo':
      // Handled by the hub, which owns the snapshot stack.
      return

    case 'setGame': {
      // Modes are fixed per session; switching is a fresh game, refused mid-question.
      if (round.phase !== 'IDLE') return
      // A pool was built under the old game's room; a seated pair is a
      // commitment and survives.
      if (state.duel && !state.duel.seated) delete state.duel
      if (!knownModule(action.id)) {
        console.warn(`[state] unknown game "${action.id}" — dropped`)
        return
      }
      const mod = moduleFor(action.id)
      const options = sanitizeOptions(mod.options, action.options)
      if (action.id === state.game.id) {
        // Re-saving the current mode's options is not a switch: scores survive.
        state.game.options = options
        return
      }
      state.game = { id: mod.id, options, moduleState: mod.init(options) }
      // A host switching modes is starting a fresh game. The flow crossing a
      // block boundary is not — erasing the standings at block 2 would be the
      // worst thing this feature could do.
      if (!action.keepScores) state.scores = {}
      state.items = {}
      state.effects = []
      round.armedAt = 0
      round.order = []
      round.total = 0
      round.lockedOut = []
      delete round.award
      delete round.fragments
      delete round.answer
      return
    }

    case 'setValue':
      round.value = action.value
      return

    case 'setAnswerWindow':
      state.answerWindowSec = Math.min(120, Math.max(0, Math.round(action.sec) || 0))
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
      // Teams constraints shape the pool; re-open under the new mode.
      if (state.duel && !state.duel.seated) delete state.duel
      return

    case 'setMirror':
      state.mirrorFragments = action.on
      return

    case 'setAutoplay':
      // Clamped here rather than at the input: a number field is a text box
      // with arrows on it, and a NaN dwell is a reader that never wakes up.
      state.autoplay = {
        on: action.on,
        nextSec: secs(action.nextSec, 5),
        reboundSec: secs(action.reboundSec, 2),
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
      // Seating happens before the question opens so candidates stamp at arm.
      if (round.phase !== 'IDLE') return
      const rule = duelRule(action.rule)
      if (!rule) return
      state.duel = { rule: rule.id, pool: [], missed: [] }
      // Instant rules (no entry gate — 'random') seat now, against everyone
      // eligible. Entry rules wait for the host to close, however they
      // resolve: 'volunteer-random' still needs its volunteer window open
      // before there is anyone to draw from.
      if (rule.entry === 'none' && rule.resolve === 'random') {
        const pair = resolveDuel(state, state.duel)
        if (pair) state.duel.seated = pair
        else delete state.duel // fewer than two eligible — nothing to close
      }
      return
    }

    case 'closeDuel': {
      const duel = state.duel
      if (!duel || duel.seated) return
      if (round.phase !== 'IDLE') return
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
      // Mid-round cancel reopens the floor for the question in flight.
      delete round.candidates
      return

    case 'setFlow': {
      // Setup, not play — refused mid-question the way setGame is.
      if (round.phase !== 'IDLE') return
      const blocks = sanitizeBlocks(action.blocks, knownModule, (id) => !!duelRule(id))
      if (blocks.length === 0) {
        delete state.flow
        return
      }
      const prev = state.flow
      // Editing block 4 during block 2 must not restart the night; a setlist
      // too short for where the room is has to start over — and so does a
      // spent one: `prev.at === prev.blocks.length` was never a block anyone
      // entered, so there is nothing mid-flight to preserve.
      const keep = prev && prev.at < prev.blocks.length && prev.at < blocks.length
      const at = keep ? prev.at : 0
      const done = keep ? Math.min(prev.done, blocks[at].count - 1) : 0
      // Keeping position doesn't mean the block AT that position is unchanged —
      // the host may have just edited the one being played. Compare it against
      // what was there before and re-apply setup alone if it moved, so the
      // room's mode never drifts from what the play strip claims. Never
      // re-open a duel here: that is a per-question event, not a per-edit one,
      // and firing it on a settings tweak would wipe an in-flight vote pool.
      const changed = keep && !sameSetup(prev.blocks[at], blocks[at])
      state.flow = { blocks, at, done }
      if (!keep) enterBlock(state, apply, true)
      else if (changed) applySetup(state, apply)
      return
    }

    case 'flowJump': {
      if (round.phase !== 'IDLE') return
      const flow = state.flow
      if (!flow) return
      const at = Number.isFinite(action.at) ? Math.round(action.at) : 0
      flow.at = Math.min(Math.max(0, at), flow.blocks.length)
      flow.done = 0
      enterBlock(state, apply, true)
      return
    }

    case 'clearFlow':
      if (round.phase !== 'IDLE') return
      // The setlist goes; the game in progress stays. Clearing a plan is not a
      // reason to change the mode or cancel a duel the room is already voting on.
      delete state.flow
      return
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
    // Snapshots from before game modes — or naming a module this build does
    // not register — must still boot.
    loaded.items ??= {}
    loaded.effects ??= []
    loaded.duelRules ??= []
    if (!Array.isArray(loaded.flows)) loaded.flows = []
    // A setlist written by another build may name modules this one does not
    // register. Drop what we cannot run rather than booting into a flow that
    // silently misbehaves at block 3.
    if (loaded.flow) {
      loaded.flow.blocks = sanitizeBlocks(loaded.flow.blocks, knownModule, (id) => !!duelRule(id))
      if (loaded.flow.blocks.length === 0) delete loaded.flow
      else {
        loaded.flow.at = Math.min(Math.max(0, loaded.flow.at | 0), loaded.flow.blocks.length)
        loaded.flow.done = Math.max(0, loaded.flow.done | 0)
      }
    }
    // A duel mid-setup can't survive a restart: the pool was voted under a
    // room that may not be back. Fresh boot, no duel — and round.candidates
    // goes with it, since without the duel it is just two ids that can buzz
    // for a reason nobody can see anymore.
    delete loaded.duel
    delete loaded.round.candidates
    if (!Array.isArray(loaded.packs)) loaded.packs = []
    if (typeof loaded.mirrorFragments !== 'boolean') loaded.mirrorFragments = false
    if (typeof loaded.answerWindowSec !== 'number') loaded.answerWindowSec = 10
    // A snapshot from before autoplay existed, or one hand-edited into nonsense.
    const auto = loaded.autoplay as Partial<State['autoplay']> | undefined
    loaded.autoplay = {
      on: auto?.on === true,
      nextSec: secs(Number(auto?.nextSec), 5),
      reboundSec: secs(Number(auto?.reboundSec), 2),
    }
    loaded.game ??= { id: 'trivia', options: {}, moduleState: {} }
    if (!knownModule(loaded.game.id)) {
      console.error(
        `[state] game "${loaded.game.id}" is not registered — falling back to trivia`,
      )
      loaded.game = { id: 'trivia', options: {}, moduleState: {} }
    }
    // Nobody is connected yet; sockets re-establish that on their own.
    for (const p of loaded.players) p.connected = false
    // A round mid-flight can't survive a restart: no timer, no pending buzzes.
    loaded.round.phase = 'IDLE'
    loaded.round.order = []
    loaded.round.total = 0
    delete loaded.round.award
    delete loaded.round.fragments
    delete loaded.round.answer
    // A reader is never mid-pack on a fresh boot — the Reader instance that
    // would drive it is built fresh too. Without this, a stale `running: true`
    // offers Pause on a reader that never started, and the next Read runs
    // paused from the first clip with nothing on screen to explain why.
    delete loaded.reading
    return loaded
  } catch (err) {
    console.error('[state] snapshot unreadable, starting fresh:', err)
    return newState()
  }
}
