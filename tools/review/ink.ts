import { makeInk } from '../../server/minigames/ink/definition.ts'
import { INK_CARDS_PATH, loadInkCards } from '../../server/minigames/ink/cards.ts'
import { CARDS } from '../../server/minigames/ink/fixtures.ts'
import type { InkWorld } from '../../server/minigames/ink/types.ts'
import type { Clock, MinigameDefinition } from '../../server/minigames/definition.ts'
import type {
  InkInput, InkPoint, InkPrivate, InkShared, InkTeamName, MinigameFrame, MinigameState, Player,
  PlayerId,
} from '../../shared/protocol.ts'

const MATCH = 'review-ink'
const TEAMS: Record<PlayerId, InkTeamName> = {
  ada: 'sun', bo: 'sun', cy: 'sun', di: 'moon', eve: 'moon', fay: 'moon',
}
const WRITERS: PlayerId[] = ['ada', 'di']
const CLOCK: Clock = (ms) => ms

const LETTER: InkPoint[] = [
  [0.12, 0.78], [0.14, 0.40], [0.20, 0.22], [0.28, 0.24], [0.32, 0.45], [0.33, 0.78],
]

export const INK_PLAYERS: Player[] = [
  { id: 'ada', name: 'Ada', connected: true },
  { id: 'bo', name: 'Bo', connected: true },
  { id: 'cy', name: 'Cy', connected: true },
  { id: 'di', name: 'Di', connected: true },
  { id: 'eve', name: 'Eve', connected: true },
  { id: 'fay', name: 'Fay', connected: true },
]

export const INK_LONG_NAMES: Record<PlayerId, string> = {
  ada: 'Maximilian', bo: 'Alexandrina', cy: 'Bartholomew', di: 'Wolfgang Amadeus Mozart', eve: 'Evangelina', fay: 'Fitzgerald',
}

export const inkSession = (phase: MinigameState['phase']): MinigameState => ({
  id: 'ink',
  matchId: MATCH,
  phase,
  options: { durationSec: 0, seed: 7 },
  participants: INK_PLAYERS.map((player) => player.id),
  lobby: { teams: TEAMS, volunteers: WRITERS, ready: [] },
})

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class InkGame {
  private readonly def: MinigameDefinition<InkWorld>
  private readonly world: InkWorld

  constructor() {
    const cards = loadInkCards(INK_CARDS_PATH)
    this.def = makeInk(() => (typeof cards === 'string' ? CARDS : cards), mulberry32(7))
    if (this.def.prepare?.()) throw new Error('Ink review fixtures could not load the card pack')
    this.world = this.def.create(7, INK_PLAYERS.map((player) => player.id), {}, inkSession('playing').lobby!).world
  }

  get turn(): InkTeamName { return this.world.turn }
  get view(): InkShared { return this.def.boardFrame(this.world, CLOCK) as InkShared }
  writer(team: InkTeamName = this.turn): PlayerId { return this.world.roster[team].writer }
  guessers(team: InkTeamName = this.turn): PlayerId[] { return this.world.roster[team].guessers }

  play(playerId: PlayerId, input: InkInput): this {
    const outcome = this.def.apply(this.world, playerId, input)
    if (outcome.status !== 'accepted') {
      throw new Error(`Ink review fixture: ${playerId} ${input.kind} refused (${outcome.reason})`)
    }
    return this
  }

  spell(count: number, who = this.guessers()[0]): this {
    for (const letter of this.wordOf().slice(0, count)) this.play(who, { kind: 'letter', value: letter, at: 0 })
    return this
  }

  missLetter(who = this.guessers()[0]): this {
    const want = this.wordOf()[this.padRow().letters.length]?.toUpperCase()
    return this.play(who, { kind: 'letter', value: want === 'Z' ? 'Q' : 'Z', at: 0 })
  }

  vote(choice: string, who = this.guessers()): this {
    for (const id of who) this.play(id, { kind: 'vote', choice, at: 0 })
    return this
  }

  stroke(playerId: PlayerId, points: InkPoint[] = LETTER): this {
    return this.play(playerId, { kind: 'stroke', points, at: 0 })
  }

  chooseWord(index = 2): this {
    for (const id of WRITERS) this.play(id, { kind: 'pickWord', index, at: 0 })
    return this
  }

  offer(): this {
    this.leavePeek()
    this.vote('ask')
    const [first, second] = this.world.hands[this.turn]
    return this.vote(`${first},${second}`)
  }

  ask(): this {
    this.offer()
    const step = this.world.step
    if (step.at !== 'keep') throw new Error('Ink review fixture: the offer did not reach a keep')
    return this.play(this.writer(), { kind: 'keep', prompt: step.offered[0], at: 0 })
  }

  clueTurn(): this {
    this.ask()
    const team = this.turn
    this.stroke(this.writer(team))
    this.play(this.guessers(team)[0], { kind: 'stop', at: 0 })
    return this.play(this.writer(team), { kind: 'done', at: 0 })
  }

  leavePeek(): this {
    const step = this.view.step
    if (step.at !== 'peekPick') return this
    this.vote(step.targets[0])
    const writing = this.view.step
    if (writing.at !== 'peekWrite') throw new Error('Ink review fixture: the peek pick did not open a row')
    this.stroke(this.writer(writing.team))
    return this.play(this.writer(writing.team), { kind: 'done', at: 0 })
  }

  board(): MinigameFrame {
    return { ...this.base(), role: 'board', ...this.view } as MinigameFrame
  }

  phone(playerId: PlayerId): MinigameFrame {
    const mine = this.def.playerFrame(this.world, playerId, CLOCK) as InkShared & InkPrivate
    return { ...this.base(), role: 'player', ...mine } as MinigameFrame
  }

  private wordOf(): string {
    if (!this.world.secret) throw new Error('Ink review fixture: the secret word is not chosen yet')
    return this.world.secret
  }

  private padRow() { return this.world.pad[this.world.turn][this.world.row] }

  private base() {
    return { id: 'ink' as const, matchId: MATCH, tick: this.def.tick(this.world), serverTime: 0 }
  }
}
