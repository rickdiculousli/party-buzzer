import { quantizePoint, validPoints } from '../../../shared/protocol.ts'
import type {
  InkPoint, InkStrokeView, MinigameResult, PlayerId, SketchEnd, SketchInput, SketchMiss, SketchStep,
} from '../../../shared/protocol.ts'
import type { InputOutcome } from '../definition.ts'
import { shuffle } from '../shuffle.ts'
import { isClose, isCorrect, letterIndexes, normalize } from './match.ts'
import { CHOICES } from './words.ts'

export const STEP_MS = 50
export const TICKS_PER_SEC = 1_000 / STEP_MS
export const CHOOSE_TICKS = 10 * TICKS_PER_SEC
export const REVEAL_TICKS = 5 * TICKS_PER_SEC
/** Wrong guesses kept for the board. */
export const FEED = 8
export const GUESS_MAX = 40

export type SketchCorrectEntry = { seq: number; player: PlayerId; at: number; tick: number }

export type SketchWorld = {
  rand: () => number
  tick: number
  drawTicks: number
  participants: PlayerId[]
  /** Drawers in turn order. */
  order: PlayerId[]
  /** Words not yet offered this match. */
  deck: string[]
  turn: number
  step: SketchStep
  /** Tick the current step ends. */
  stepEnds: number
  /** Tick the current drawing started. */
  drawStart: number
  choices: string[]
  word: string | null
  revealed: number[]
  /** Ticks at which the remaining hints are due. */
  hintAt: number[]
  strokes: InkStrokeView[]
  strokesVersion: number
  sentVersion: number
  nextStrokesTick: number
  live: InkPoint[] | null
  inkOps: Record<PlayerId, number>
  misses: SketchMiss[]
  correct: SketchCorrectEntry[]
  guessSeq: number
  close: Record<PlayerId, number>
  end: SketchEnd | null
  scores: Record<PlayerId, number>
}

const OK: InputOutcome = { status: 'accepted' }
const NO: InputOutcome = { status: 'refused', reason: 'not-allowed' }
const INVALID: InputOutcome = { status: 'refused', reason: 'invalid' }

export function createSketchWorld(input: {
  rand: () => number
  words: string[]
  participants: PlayerId[]
  drawSec: number
  drawers: number
}): SketchWorld {
  const { rand, words, participants, drawSec, drawers } = input
  const order = shuffle(rand, participants)
  const w: SketchWorld = {
    rand, tick: 0, drawTicks: drawSec * TICKS_PER_SEC, participants,
    order: drawers > 0 ? order.slice(0, drawers) : order,
    deck: shuffle(rand, words),
    turn: 0, step: 'choosing', stepEnds: 0, drawStart: 0, choices: [], word: null, revealed: [], hintAt: [],
    strokes: [], strokesVersion: 0, sentVersion: 0, nextStrokesTick: 0, live: null, inkOps: {},
    misses: [], correct: [], guessSeq: 0, close: {}, end: null,
    scores: Object.fromEntries(participants.map((id) => [id, 0])),
  }
  beginTurn(w)
  return w
}

export const drawerOf = (w: SketchWorld): PlayerId | undefined => w.order[w.turn]

function beginTurn(w: SketchWorld): void {
  w.strokes = []
  w.strokesVersion++
  w.live = null
  w.misses = []
  w.correct = []
  w.close = {}
  w.revealed = []
  w.hintAt = []
  w.end = null
  w.word = null
  if (w.turn >= w.order.length) {
    w.step = 'over'
    w.choices = []
    return
  }
  w.choices = w.deck.splice(0, CHOICES)
  w.step = 'choosing'
  w.stepEnds = w.tick + CHOOSE_TICKS
}

function startDrawing(w: SketchWorld, word: string): void {
  w.word = word
  w.choices = []
  w.step = 'drawing'
  w.drawStart = w.tick
  w.stepEnds = w.tick + w.drawTicks
  w.hintAt = letterIndexes(word).length > 3
    ? [w.tick + Math.round(w.drawTicks / 2), w.tick + Math.round(w.drawTicks * 3 / 4)]
    : []
}

function endTurn(w: SketchWorld, end: SketchEnd): void {
  w.scores[drawerOf(w)!] += Math.round(100 * w.correct.length / (w.participants.length - 1))
  w.step = 'reveal'
  w.end = end
  w.live = null
  w.stepEnds = w.tick + REVEAL_TICKS
}

function revealHint(w: SketchWorld): void {
  const hidden = letterIndexes(w.word!).filter((i) => !w.revealed.includes(i))
  // A hint never gives away the last hidden letter.
  if (hidden.length > 1) w.revealed.push(hidden[Math.floor(w.rand() * hidden.length)])
}

export function stepSketch(w: SketchWorld): void {
  w.tick++
  if (w.step === 'choosing' && w.tick >= w.stepEnds) startDrawing(w, w.choices[0])
  else if (w.step === 'drawing') {
    while (w.hintAt.length && w.tick >= w.hintAt[0]) {
      w.hintAt.shift()
      revealHint(w)
    }
    if (w.tick >= w.stepEnds) endTurn(w, 'timeup')
  } else if (w.step === 'reveal' && w.tick >= w.stepEnds) {
    w.turn++
    beginTurn(w)
  }
}

function guess(w: SketchWorld, player: PlayerId, raw: string, at: number): InputOutcome {
  if (w.step !== 'drawing' || player === drawerOf(w) || w.correct.some((c) => c.player === player)) return NO
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text || text.length > GUESS_MAX) return INVALID
  const seq = ++w.guessSeq
  if (isCorrect(text, w.word!)) {
    w.scores[player] += 50 + Math.round(50 * Math.max(0, w.stepEnds - w.tick) / w.drawTicks)
    w.correct.push({ seq, player, at, tick: w.tick })
    if (w.correct.length === w.participants.length - 1) endTurn(w, 'all')
  } else if (isClose(text, w.word!) || normalize(text).includes(normalize(w.word!))) {
    // A guess that contains the word would show the room the answer, so it counts as close.
    w.close[player] = (w.close[player] ?? 0) + 1
  } else {
    w.misses = [...w.misses, { seq, player, text }].slice(-FEED)
  }
  return OK
}

export function applySketch(w: SketchWorld, playerId: PlayerId, input: SketchInput): InputOutcome {
  if (!w.participants.includes(playerId)) return NO
  if (input.kind === 'stroke' || input.kind === 'undo' || input.kind === 'clear') {
    w.inkOps[playerId] = (w.inkOps[playerId] ?? 0) + 1
  }
  const drawer = playerId === drawerOf(w)
  const drawing = w.step === 'drawing' && drawer
  switch (input.kind) {
    case 'pickWord': {
      if (w.step !== 'choosing' || !drawer) return NO
      const word = w.choices[input.index]
      if (word === undefined) return INVALID
      startDrawing(w, word)
      return OK
    }
    case 'ink':
      if (!drawing || !validPoints(input.points)) return NO
      w.live = input.points.map(([x, y]) => quantizePoint(x, y))
      return OK
    case 'stroke':
      if (!drawing || !validPoints(input.points)) return NO
      w.strokes.push({ points: input.points.map(([x, y]) => quantizePoint(x, y)), author: playerId })
      w.live = null
      w.strokesVersion++
      return OK
    case 'undo':
      if (!drawing || !w.strokes.length) return NO
      w.strokes.pop()
      w.strokesVersion++
      return OK
    case 'clear':
      if (!drawing || !w.strokes.length) return NO
      w.strokes = []
      w.strokesVersion++
      return OK
    case 'pass':
      if (!drawing) return NO
      endTurn(w, 'pass')
      return OK
    case 'guess':
      return guess(w, playerId, input.text, input.at)
  }
  return NO
}

export const sketchFinished = (w: SketchWorld) => w.step === 'over'

export function sketchResults(w: SketchWorld): MinigameResult[] {
  return w.participants
    .map((playerId) => ({ playerId, points: w.scores[playerId], shots: 0 }))
    .sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : 1))
}
