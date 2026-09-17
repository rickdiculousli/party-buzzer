import type { InkPrivate, InkShared, InkStepView, PlayerId } from '../../../shared/protocol.ts'
import type { MinigameDefinition } from '../definition.ts'
import { lobbyStartable } from '../lobby.ts'
import { INK_CARDS_PATH, loadInkCards, type InkCards } from './cards.ts'
import type { InkWorld } from './types.ts'
import {
  applyInk, createInkWorld, inkFinished, inkResults, inkTarget, peekTargets, roleOf, validPoints,
} from './world.ts'

const STEP_MS = 50
const PAD_EVERY_TICKS = 20
const DISCRETE = new Set(['pickWord', 'vote', 'force', 'keep', 'stroke', 'undo', 'stop', 'done', 'endClue', 'check', 'judge', 'finishGuess', 'verdict'])

const sendsPad = (w: InkWorld) => w.padVersion !== w.sentVersion || w.tick >= w.nextPadTick

function stepView(w: InkWorld): InkStepView {
  const s = w.step
  switch (s.at) {
    case 'peekPick': return { at: 'peekPick', targets: peekTargets(w) }
    case 'peekWrite': return { at: 'peekWrite', team: s.team, row: s.row }
    case 'choose': return { at: 'choose', canRedraw: !w.redrawn[w.turn] }
    case 'keep': return { at: 'keep' }
    case 'clue': return { at: 'clue', stopped: s.stopped }
    case 'guess': return { at: 'guess', holder: s.holder }
    default: return s
  }
}

function shared(w: InkWorld): InkShared {
  const live: InkShared['live'] = []
  for (const [player, points] of Object.entries(w.live)) {
    const target = inkTarget(w, player)
    if (target) live.push({ player, team: target.team, row: target.row, points })
  }
  return {
    roster: w.roster,
    turn: w.turn,
    row: w.row,
    step: stepView(w),
    ...(sendsPad(w) ? { pad: w.pad } : {}),
    live,
    discard: w.discard.map((id) => w.cards.prompts[id]),
    deck: w.deck.length,
    secret: w.step.at === 'over' ? w.secret : null,
  }
}

function personal(w: InkWorld, playerId: PlayerId): InkPrivate | null {
  const me = roleOf(w, playerId)
  if (!me) return null
  const card = (id: number) => ({ id, text: w.cards.prompts[id] })
  const s = w.step
  const ours = me.team === w.turn
  const writer = me.role === 'writer'
  const undo = w.undoable
  const target = inkTarget(w, playerId)
  return {
    me,
    hand: writer ? [] : w.hands[me.team].map(card),
    votes: w.votes.filter(() => ours).map(({ player, choice }) => ({ player, choice })),
    asked: w.asked[me.team].map((id) => w.cards.prompts[id]),
    offered: ours && s.at === 'keep' ? s.offered.map(card) : [],
    kept: ours && s.at === 'clue' ? w.cards.prompts[s.prompt] : null,
    wordCard: writer && s.at === 'choosing' ? w.wordCard : [],
    picks: writer && s.at === 'choosing' ? w.picks : {},
    canUndo: !!undo && !!target && undo.player === playerId && undo.team === target.team && undo.row === target.row,
    inkOps: w.inkOps[playerId] ?? 0,
  }
}

/** Touches point at options a Guesser is voting on right now; anything else is dropped. */
function touchable(w: InkWorld, playerId: PlayerId, target: string): boolean {
  const me = roleOf(w, playerId)
  if (me?.role !== 'guesser' || me.team !== w.turn) return false
  const [kind, ...rest] = target.split(':')
  const value = rest.join(':')
  if (w.step.at === 'choose') return kind === 'vote' && (value === 'ask' || value === 'guess' || (value === 'redraw' && !w.redrawn[w.turn]))
  if (w.step.at === 'offer') return kind === 'card' && w.hands[w.turn].includes(Number(value))
  if (w.step.at === 'peekPick') return kind === 'row' && peekTargets(w).includes(value)
  return false
}

export function makeInk(load: () => InkCards | string, rand: () => number = Math.random): MinigameDefinition<InkWorld> {
  let cards: InkCards | null = null
  return {
    stepMs: STEP_MS,
    untimed: true,
    options: () => ({}),
    prepare() {
      const loaded = load()
      if (typeof loaded === 'string') return 'ink-cards'
      cards = loaded
      return null
    },
    startable: lobbyStartable,
    create(_seed, participants, _options, lobby) {
      // prepare() runs before every start, so the cards are loaded here.
      return { world: createInkWorld({ rand, cards: cards!, lobby, participants }) }
    },
    finished: inkFinished,
    classify(input) {
      const i = input as { kind?: unknown; at?: unknown; points?: unknown; index?: unknown; choice?: unknown; prompt?: unknown; correct?: unknown; win?: unknown } | null
      if (i?.kind === 'ink') return validPoints(i.points) ? 'continuous' : null
      if (typeof i?.kind !== 'string' || !DISCRETE.has(i.kind) || typeof i.at !== 'number' || !Number.isFinite(i.at)) return null
      if (i.kind === 'stroke' && !validPoints(i.points)) return null
      if (i.kind === 'pickWord' && !Number.isInteger(i.index)) return null
      if (i.kind === 'vote' && typeof i.choice !== 'string') return null
      if (i.kind === 'keep' && !Number.isInteger(i.prompt)) return null
      if (i.kind === 'judge' && typeof i.correct !== 'boolean') return null
      if (i.kind === 'verdict' && typeof i.win !== 'boolean') return null
      return 'discrete'
    },
    apply: (world, playerId, input) => applyInk(world, playerId, input),
    step(world) { world.tick++ },
    afterFrame(world) {
      if (!sendsPad(world)) return
      world.sentVersion = world.padVersion
      world.nextPadTick = world.tick + PAD_EVERY_TICKS
    },
    tick: (world) => world.tick,
    boardFrame: (world) => shared(world),
    playerFrame(world, playerId) {
      const mine = personal(world, playerId)
      if (!mine) return null
      const view = shared(world)
      // Writers know the secret word from the start.
      return { ...view, ...mine, secret: mine.me.role === 'writer' ? world.secret : view.secret }
    },
    results: inkResults,
    touchAudience(world, playerId, target) {
      if (!touchable(world, playerId, target)) return null
      const { writer, guessers } = world.roster[world.turn]
      return { players: [writer, ...guessers], board: target.startsWith('row:') }
    },
  }
}

export const ink = makeInk(() => loadInkCards(INK_CARDS_PATH))
