import { randomUUID } from 'node:crypto'
import type {
  ActionResult, HostAction, MinigameFrame, MinigameInputAck, MinigameInputMsg, MinigameResult, Role, State,
} from '../../shared/protocol.ts'
import { numberOption, type MinigameDefinition } from './definition.ts'
import { MINIGAMES } from './registry.ts'

const COUNTDOWN_MS = 3_000
const LANDING_GRACE_MS = 3_000
const INPUT_GRACE_MS = 250
const FRAME_MS = 50
const MAX_STEPS_PER_PUMP = 8

type RuntimeAction = Extract<HostAction,
  { a: 'prepareMinigame' | 'startMinigame' | 'cancelMinigame' | 'closeMinigame' }>

type Hooks = {
  now?: () => number
  onState: (cause: string) => void
  onFrame: () => void
  onAck: (playerId: string, ack: MinigameInputAck) => void
  onComplete: (matchId: string, results: MinigameResult[]) => void
}

type Pending = { playerId: string; seq: number; input: unknown; discrete: boolean }

export class MinigameRuntime {
  private state: State
  private hooks: Hooks
  private world: unknown = null
  private readonly now: () => number
  private lastPump = 0
  private accumulator = 0
  private skippedMs = 0
  private lastFrame = 0
  private pending: Pending[] = []
  private dispositions = new Map<string, MinigameInputAck>()
  private completed = false

  constructor(state: State, hooks: Hooks) {
    this.state = state
    this.hooks = hooks
    this.now = hooks.now ?? Date.now
  }

  private definition(): MinigameDefinition<unknown> | null {
    const id = this.state.minigame?.id
    return id && Object.hasOwn(MINIGAMES, id) ? MINIGAMES[id] : null
  }

  host(action: RuntimeAction): ActionResult {
    if (action.a === 'prepareMinigame') {
      if (this.state.round.phase !== 'IDLE' || this.state.minigame?.phase === 'playing' || this.state.minigame?.phase === 'countdown') {
        return { status: 'refused', reason: 'not-idle' }
      }
      if (!Object.hasOwn(MINIGAMES, action.id)) return { status: 'refused', reason: 'unknown-mode' }
      const options = {
        ...MINIGAMES[action.id].options(action.options),
        durationSec: numberOption(action.options.durationSec, 40, 5, 180),
        seed: numberOption(action.options.seed, Math.floor(this.now()), 0, 2_147_483_647),
      }
      this.resetTransient()
      this.state.minigame = {
        id: action.id, matchId: randomUUID(), phase: 'ready', options, participants: [],
      }
      return { status: 'applied' }
    }

    const session = this.state.minigame
    const definition = this.definition()
    if (!session || !definition) return { status: 'unchanged' }

    if (action.a === 'startMinigame') {
      if (session.phase !== 'ready') return { status: 'unchanged' }
      const participants = this.state.players.filter((player) => player.connected).map((player) => player.id).sort()
      if (participants.length === 0) return { status: 'refused', reason: 'no-players' }
      const startsAt = this.now() + COUNTDOWN_MS
      session.matchId = randomUUID()
      session.phase = 'countdown'
      session.participants = participants
      session.startsAt = startsAt
      session.endsAt = startsAt + session.options.durationSec * 1_000
      delete session.results
      const created = definition.create(session.options.seed, participants, session.options)
      this.world = created.world
      if (created.crews) session.crews = created.crews
      else delete session.crews
      this.lastPump = startsAt
      this.lastFrame = 0
      this.skippedMs = 0
      this.completed = false
      return { status: 'applied' }
    }

    if (action.a === 'cancelMinigame') {
      if (session.phase === 'ready') return { status: 'unchanged' }
      this.resetTransient()
      this.state.minigame = {
        ...session, matchId: randomUUID(), phase: 'ready', participants: [],
        startsAt: undefined, endsAt: undefined, results: undefined, crews: undefined,
      }
      return { status: 'applied' }
    }

    this.resetTransient()
    delete this.state.minigame
    return { status: 'applied' }
  }

  input(playerId: string, msg: MinigameInputMsg): void {
    const session = this.state.minigame
    const key = `${playerId}:${msg.seq}`
    const prior = this.dispositions.get(key)
    if (prior) {
      this.hooks.onAck(playerId, prior)
      return
    }
    const kind = this.definition()?.classify(msg.input) ?? null
    const refuse = (reason: NonNullable<MinigameInputAck['reason']>) => {
      if (kind !== 'discrete') return
      const ack: MinigameInputAck = { matchId: msg.matchId, seq: msg.seq, status: 'refused', reason }
      this.dispositions.set(key, ack)
      this.hooks.onAck(playerId, ack)
    }
    if (!session || msg.matchId !== session.matchId || !this.world) return refuse('stale-match')
    if (!session.participants.includes(playerId)) return refuse('not-participant')
    if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) return refuse('invalid')
    if (!kind) return
    if (kind === 'continuous') {
      this.pending.push({ playerId, seq: msg.seq, input: msg.input, discrete: false })
      return
    }

    const arrival = this.now()
    const at = (msg.input as { at: number }).at
    if (session.phase !== 'playing') return refuse('not-playing')
    if (arrival > (session.endsAt ?? 0) + INPUT_GRACE_MS || Math.min(arrival, Math.max(session.startsAt ?? 0, at)) > (session.endsAt ?? 0)) {
      return refuse('not-playing')
    }
    if (this.pending.some((item) => item.discrete && item.playerId === playerId && item.seq === msg.seq)) return
    this.pending.push({ playerId, seq: msg.seq, input: msg.input, discrete: true })
  }

  pump(): void {
    const session = this.state.minigame
    const definition = this.definition()
    if (!session || !definition || !this.world || !session.startsAt || !session.endsAt) return
    const now = this.now()
    if (session.phase === 'countdown') {
      if (now < session.startsAt) {
        if (now - this.lastFrame >= FRAME_MS) {
          this.lastFrame = now
          this.broadcast(definition)
        }
        return
      }
      session.phase = 'playing'
      this.lastPump = session.startsAt
      this.hooks.onState('minigame:playing')
    }
    if (session.phase !== 'playing') return

    const until = Math.min(now, session.endsAt + LANDING_GRACE_MS)
    this.accumulator += Math.max(0, until - this.lastPump)
    this.lastPump = until
    let steps = 0
    while (this.accumulator + 1e-9 >= definition.stepMs && steps < MAX_STEPS_PER_PUMP) {
      for (const item of this.pending.splice(0)) {
        const outcome = definition.apply(this.world, item.playerId, item.input)
        if (!item.discrete) continue
        const ack: MinigameInputAck = outcome.status === 'accepted'
          ? { matchId: session.matchId, seq: item.seq, status: 'accepted' }
          : { matchId: session.matchId, seq: item.seq, status: 'refused', reason: outcome.reason }
        this.dispositions.set(`${item.playerId}:${item.seq}`, ack)
        this.hooks.onAck(item.playerId, ack)
      }
      definition.step(this.world)
      this.accumulator -= definition.stepMs
      steps++
    }
    if (steps === MAX_STEPS_PER_PUMP && this.accumulator >= definition.stepMs) {
      const remainder = this.accumulator % definition.stepMs
      this.skippedMs += this.accumulator - remainder
      this.accumulator = remainder
    }
    this.broadcast(definition)
    if (!this.completed && now >= session.endsAt + LANDING_GRACE_MS) {
      this.completed = true
      this.hooks.onComplete(session.matchId, definition.results(this.world))
    }
  }

  frameFor(role: Role, playerId?: string): MinigameFrame | null {
    const session = this.state.minigame
    const definition = this.definition()
    const world = this.world
    if (!session || !definition || !world) return null
    const base = { id: session.id, matchId: session.matchId, tick: definition.tick(world), serverTime: this.now() }
    const clock = (worldMs: number) => session.startsAt! + this.skippedMs + worldMs
    if (role === 'board') return { ...base, role: 'board', ...definition.boardFrame(world, clock) } as MinigameFrame
    const player = playerId ? definition.playerFrame(world, playerId, clock) : null
    if (!player) return { ...base, role: 'spectator' } as MinigameFrame
    return { ...base, role: 'player', ...player } as MinigameFrame
  }

  finish(matchId: string, results: MinigameResult[]): boolean {
    const session = this.state.minigame
    if (!session || session.matchId !== matchId || session.phase !== 'playing') return false
    session.phase = 'results'
    session.results = results
    this.resetTransient(false)
    return true
  }

  stop(): void { this.resetTransient() }

  private broadcast(definition: MinigameDefinition<unknown>): void {
    this.hooks.onFrame()
    definition.afterFrame?.(this.world)
  }

  private resetTransient(clearCompleted = true): void {
    this.world = null
    this.pending = []
    this.dispositions.clear()
    this.accumulator = 0
    this.skippedMs = 0
    if (clearCompleted) this.completed = false
  }
}
