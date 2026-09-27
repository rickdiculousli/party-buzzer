import { makeSketch } from '../../server/minigames/sketch/definition.ts'
import { SKETCH_WORDS_PATH, loadSketchWords } from '../../server/minigames/sketch/words.ts'
import { STEP_MS, type SketchWorld } from '../../server/minigames/sketch/world.ts'
import type { Clock, MinigameDefinition } from '../../server/minigames/definition.ts'
import type {
  InkPoint, MinigameFrame, MinigameResult, MinigameState, Player, PlayerId, SketchInput, SketchPrivate, SketchShared,
} from '../../shared/protocol.ts'

const MATCH = 'review-sketch'
const FALLBACK_WORDS = ['lighthouse', 'giraffe', 'birthday cake', 'rocket', 'umbrella', 'snowman', 'volcano',
  'guitar', 'pirate', 'octopus', 'castle', 'bicycle', 'cactus', 'robot', 'penguin', 'pizza', 'dragon', 'kite']

/** A house with a door and a sun, drawn in the canvas's unit square. */
const HOUSE: InkPoint[][] = [
  [[0.25, 0.85], [0.25, 0.5], [0.5, 0.25], [0.75, 0.5], [0.75, 0.85], [0.25, 0.85]],
  [[0.45, 0.85], [0.45, 0.65], [0.55, 0.65], [0.55, 0.85]],
  [[0.2, 0.52], [0.5, 0.2], [0.8, 0.52]],
  [[0.85, 0.12], [0.9, 0.1], [0.93, 0.15], [0.9, 0.2], [0.85, 0.18], [0.85, 0.12]],
]
const WRONG = ['a house?', 'barn', 'is that a very sad horse', 'PANCAKE', 'tent', 'church', 'shed', 'home', 'cabin']

export const SKETCH_PLAYERS: Player[] = [
  { id: 'ada', name: 'Ada', connected: true },
  { id: 'bo', name: 'Bo', connected: true },
  { id: 'cy', name: 'Cy', connected: true },
  { id: 'di', name: 'Di', connected: true },
  { id: 'eve', name: 'Eve', connected: true },
  { id: 'fay', name: 'Fay', connected: true },
]

export const sketchSession = (phase: MinigameState['phase'], results?: MinigameResult[]): MinigameState => ({
  id: 'sketch',
  matchId: MATCH,
  phase,
  options: { durationSec: 0, seed: 7, drawSec: 80, drawers: 0 },
  participants: SKETCH_PLAYERS.map((player) => player.id),
  lobby: { teams: {}, volunteers: [] },
  ...(results ? { results } : {}),
})

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Drives the real Sketch rules to a state, so a preview cannot show an impossible one. */
export class SketchGame {
  private readonly def: MinigameDefinition<SketchWorld>
  private readonly world: SketchWorld
  private readonly now: number
  private at = 0

  constructor(now: number) {
    this.now = now
    this.def = makeSketch(() => loadSketchWords(SKETCH_WORDS_PATH) ?? FALLBACK_WORDS, mulberry32(7))
    if (this.def.prepare?.()) throw new Error('Sketch review fixtures could not load the word list')
    const ids = SKETCH_PLAYERS.map((player) => player.id)
    this.world = this.def.create(7, ids, sketchSession('playing').options, sketchSession('playing').lobby!).world
  }

  get drawer(): PlayerId { return this.world.order[this.world.turn] }
  get guessers(): PlayerId[] { return this.world.participants.filter((id) => id !== this.drawer) }
  get word(): string {
    if (!this.world.word) throw new Error('Sketch review fixture: no word chosen yet')
    return this.world.word
  }

  /** Refuse loudly: a fixture that silently dropped an input would show a lie. */
  play(playerId: PlayerId, input: Record<string, unknown>): this {
    const outcome = this.def.apply(this.world, playerId, { at: this.clock(this.world.tick * STEP_MS) + this.at++, ...input } as SketchInput)
    if (outcome.status !== 'accepted') {
      throw new Error(`Sketch review fixture: ${playerId} ${String(input.kind)} refused (${outcome.reason})`)
    }
    return this
  }

  pick(index = 0): this { return this.play(this.drawer, { kind: 'pickWord', index }) }

  draw(strokes = HOUSE): this {
    for (const points of strokes) this.play(this.drawer, { kind: 'stroke', points })
    return this
  }

  wait(seconds: number): this {
    for (let i = 0; i < seconds * 1_000 / STEP_MS; i++) this.def.step(this.world)
    return this
  }

  guess(playerId: PlayerId, text: string): this { return this.play(playerId, { kind: 'guess', text }) }

  /** One wrong guess from each guesser still guessing, in turn, `count` in all. */
  misses(count: number): this {
    const open = this.guessers.filter((id) => !this.world.correct.some((c) => c.player === id))
    for (let i = 0; i < count; i++) this.guess(open[i % open.length], WRONG[i % WRONG.length])
    return this
  }

  close(playerId: PlayerId): this { return this.guess(playerId, this.word.slice(0, -1)) }

  board(): MinigameFrame {
    return { ...this.base(), role: 'board', ...(this.def.boardFrame(this.world, this.clockFn()) as SketchShared) } as MinigameFrame
  }

  phone(playerId: PlayerId): MinigameFrame {
    const mine = this.def.playerFrame(this.world, playerId, this.clockFn()) as (SketchShared & SketchPrivate) | null
    return (mine ? { ...this.base(), role: 'player', ...mine } : { ...this.base(), role: 'spectator' }) as MinigameFrame
  }

  /** World time mapped so the current tick lands on the preview's `now`. */
  private clock(worldMs: number): number { return this.now - this.world.tick * STEP_MS + worldMs }
  private clockFn(): Clock { return (worldMs) => this.clock(worldMs) }

  private base() {
    return { id: 'sketch' as const, matchId: MATCH, tick: this.def.tick(this.world), serverTime: this.now }
  }
}
