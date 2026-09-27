import { validPoints } from '../../../shared/protocol.ts'
import type { PlayerId, SketchCorrect, SketchPrivate, SketchShared } from '../../../shared/protocol.ts'
import type { Clock, MinigameDefinition } from '../definition.ts'
import { blanks } from './match.ts'
import { CHOICES, SKETCH_WORDS_PATH, loadSketchWords } from './words.ts'
import {
  STEP_MS, TICKS_PER_SEC, applySketch, createSketchWorld, drawerOf, sketchFinished, sketchResults, stepSketch,
  type SketchWorld,
} from './world.ts'

const DISCRETE = new Set(['pickWord', 'stroke', 'undo', 'clear', 'pass', 'guess'])

const sendsStrokes = (w: SketchWorld) => w.strokesVersion !== w.sentVersion || w.tick >= w.nextStrokesTick

/** Times come from each press, clamped to the drawing and to the step that took it. */
function correctView(w: SketchWorld, clock: Clock): SketchCorrect[] {
  const start = clock(w.drawStart * STEP_MS)
  return w.correct
    .map((c) => ({
      seq: c.seq,
      player: c.player,
      ms: Math.round(Math.min(clock((c.tick + 1) * STEP_MS), Math.max(start, c.at)) - start),
    }))
    .sort((a, b) => a.ms - b.ms || a.seq - b.seq)
}

function shared(w: SketchWorld, clock: Clock): SketchShared {
  const shown = w.step === 'reveal' || w.step === 'over'
  return {
    step: w.step,
    drawer: drawerOf(w) ?? w.order[w.order.length - 1],
    turn: Math.min(w.turn, w.order.length - 1),
    turns: w.order.length,
    blanks: w.word ? blanks(w.word, w.revealed) : '',
    ...(sendsStrokes(w) ? { strokes: w.strokes } : {}),
    live: w.live,
    endsAt: clock(w.stepEnds * STEP_MS),
    misses: w.misses,
    correct: correctView(w, clock),
    end: w.end,
    scores: { ...w.scores },
    word: shown ? w.word : null,
  }
}

function personal(w: SketchWorld, playerId: PlayerId): (SketchPrivate & { word?: string | null }) | null {
  if (!w.participants.includes(playerId)) return null
  const drawer = drawerOf(w) === playerId
  const knows = (drawer && w.step === 'drawing') || w.correct.some((c) => c.player === playerId)
  return {
    choices: drawer && w.step === 'choosing' ? w.choices : [],
    close: w.close[playerId] ?? 0,
    inkOps: w.inkOps[playerId] ?? 0,
    ...(knows ? { word: w.word } : {}),
  }
}

export function makeSketch(load: () => string[] | null, rand: () => number = Math.random): MinigameDefinition<SketchWorld> {
  let words: string[] = []
  return {
    stepMs: STEP_MS,
    untimed: true,
    prepare() {
      const loaded = load()
      if (!loaded || loaded.length < CHOICES) return 'sketch-words'
      words = loaded
      return null
    },
    startable(_lobby, connected) {
      if (connected.length < 2) return 'too-few-players'
      // ponytail: sized for everyone drawing; the Drawers option only lowers the need.
      return words.length < CHOICES * connected.length ? 'sketch-words' : null
    },
    create(_seed, participants, options) {
      return { world: createSketchWorld({ rand, words, participants, drawSec: options.drawSec, drawers: options.drawers }) }
    },
    finished: sketchFinished,
    classify(input) {
      const i = input as { kind?: unknown; at?: unknown; points?: unknown; index?: unknown; text?: unknown } | null
      if (i?.kind === 'ink') return validPoints(i.points) ? 'continuous' : null
      if (typeof i?.kind !== 'string' || !DISCRETE.has(i.kind) || typeof i.at !== 'number' || !Number.isFinite(i.at)) return null
      if (i.kind === 'stroke' && !validPoints(i.points)) return null
      if (i.kind === 'pickWord' && !Number.isInteger(i.index)) return null
      if (i.kind === 'guess' && typeof i.text !== 'string') return null
      return 'discrete'
    },
    apply: (world, playerId, input) => applySketch(world, playerId, input),
    step: stepSketch,
    afterFrame(world) {
      if (!sendsStrokes(world)) return
      world.sentVersion = world.strokesVersion
      world.nextStrokesTick = world.tick + TICKS_PER_SEC
    },
    tick: (world) => world.tick,
    boardFrame: (world, clock) => shared(world, clock),
    playerFrame(world, playerId, clock) {
      const mine = personal(world, playerId)
      return mine && { ...shared(world, clock), ...mine }
    },
    results: sketchResults,
  }
}

export const sketch = makeSketch(() => loadSketchWords(SKETCH_WORDS_PATH))
