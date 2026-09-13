import { randomUUID } from 'node:crypto'
import type {
  ActionResult, BowInputAck, BowInputMsg, HostAction, MinigameFrame, MinigameResult, Role, State,
} from '../../shared/protocol.ts'
import { BOW_FIELD, BOW_STEP_MS } from './bow/types.ts'
import { bowResults, createBowWorld, releaseBow, sampleBowTrajectory, setBowAim, stepBow } from './bow/world.ts'
import type { BowWorld } from './bow/types.ts'

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
  onAck: (playerId: string, ack: BowInputAck) => void
  onComplete: (matchId: string, results: MinigameResult[]) => void
}

type PendingRelease = { playerId: string; seq: number }

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export class MinigameRuntime {
  private state: State
  private hooks: Hooks
  private world: BowWorld | null = null
  private readonly now: () => number
  private lastPump = 0
  private accumulator = 0
  private skippedMs = 0
  private lastFrame = 0
  private pendingAim = new Map<string, { angle: number; tension: number }>()
  private pendingRelease: PendingRelease[] = []
  private dispositions = new Map<string, BowInputAck>()
  private completed = false

  constructor(state: State, hooks: Hooks) {
    this.state = state
    this.hooks = hooks
    this.now = hooks.now ?? Date.now
  }

  host(action: RuntimeAction): ActionResult {
    if (action.a === 'prepareMinigame') {
      if (this.state.round.phase !== 'IDLE' || this.state.minigame?.phase === 'playing' || this.state.minigame?.phase === 'countdown') {
        return { status: 'refused', reason: 'not-idle' }
      }
      const options = {
        durationSec: numberOption(action.options.durationSec, 40, 5, 180),
        reloadMs: numberOption(action.options.reloadMs, 100, 0, 5_000),
        seed: numberOption(action.options.seed, Math.floor(this.now()), 0, 2_147_483_647),
      }
      this.resetTransient()
      this.state.minigame = {
        id: 'bow', matchId: randomUUID(), phase: 'ready', options, participants: [],
      }
      return { status: 'applied' }
    }

    const session = this.state.minigame
    if (!session) return { status: 'unchanged' }

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
      this.world = createBowWorld({
        seed: session.options.seed,
        playerIds: participants,
        config: { reloadMs: session.options.reloadMs },
      })
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
        startsAt: undefined, endsAt: undefined, results: undefined,
      }
      return { status: 'applied' }
    }

    this.resetTransient()
    delete this.state.minigame
    return { status: 'applied' }
  }

  input(playerId: string, msg: BowInputMsg): void {
    const session = this.state.minigame
    const key = `${playerId}:${msg.seq}`
    const prior = this.dispositions.get(key)
    if (prior) {
      this.hooks.onAck(playerId, prior)
      return
    }
    const refuse = (reason: NonNullable<BowInputAck['reason']>) => {
      if (msg.input.kind !== 'release') return
      const ack: BowInputAck = { matchId: msg.matchId, seq: msg.seq, status: 'refused', reason }
      this.dispositions.set(key, ack)
      this.hooks.onAck(playerId, ack)
    }
    if (!session || msg.matchId !== session.matchId || !this.world) return refuse('stale-match')
    if (!session.participants.includes(playerId)) return refuse('not-participant')
    if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) return refuse('invalid')

    if (msg.input.kind === 'aim') {
      if (!Number.isFinite(msg.input.angle) || !Number.isFinite(msg.input.tension)) return
      this.pendingAim.set(playerId, { angle: msg.input.angle, tension: msg.input.tension })
      return
    }

    const arrival = this.now()
    const releaseAt = msg.input.at
    if (!Number.isFinite(releaseAt)) return refuse('invalid')
    if (session.phase !== 'playing') return refuse('not-playing')
    if (arrival > (session.endsAt ?? 0) + INPUT_GRACE_MS || Math.min(arrival, Math.max(session.startsAt ?? 0, releaseAt)) > (session.endsAt ?? 0)) {
      return refuse('not-playing')
    }
    if (this.pendingRelease.some((release) => release.playerId === playerId && release.seq === msg.seq)) return
    this.pendingRelease.push({ playerId, seq: msg.seq })
  }

  pump(): void {
    const session = this.state.minigame
    if (!session || !this.world || !session.startsAt || !session.endsAt) return
    const now = this.now()
    if (session.phase === 'countdown') {
      if (now < session.startsAt) {
        if (now - this.lastFrame >= FRAME_MS) {
          this.lastFrame = now
          this.hooks.onFrame()
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
    while (this.accumulator + 1e-9 >= BOW_STEP_MS && steps < MAX_STEPS_PER_PUMP) {
      for (const [playerId, aim] of this.pendingAim) setBowAim(this.world, playerId, aim)
      this.pendingAim.clear()
      for (const release of this.pendingRelease.splice(0)) {
        const result = releaseBow(this.world, release.playerId)
        const ack: BowInputAck = result.status === 'accepted'
          ? { matchId: session.matchId, seq: release.seq, status: 'accepted' }
          : { matchId: session.matchId, seq: release.seq, status: 'refused', reason: result.reason === 'unknown-player' ? 'not-participant' : result.reason }
        this.dispositions.set(`${release.playerId}:${release.seq}`, ack)
        this.hooks.onAck(release.playerId, ack)
      }
      stepBow(this.world)
      this.accumulator -= BOW_STEP_MS
      steps++
    }
    if (steps === MAX_STEPS_PER_PUMP && this.accumulator >= BOW_STEP_MS) {
      const remainder = this.accumulator % BOW_STEP_MS
      this.skippedMs += this.accumulator - remainder
      this.accumulator = remainder
    }
    this.hooks.onFrame()
    if (!this.completed && now >= session.endsAt + LANDING_GRACE_MS) {
      this.completed = true
      this.hooks.onComplete(session.matchId, bowResults(this.world))
    }
  }

  frameFor(role: Role, playerId?: string): MinigameFrame | null {
    const session = this.state.minigame
    const world = this.world
    if (!session || !world) return null
    const base = { id: 'bow' as const, matchId: session.matchId, tick: world.tick, serverTime: this.now() }
    if (role === 'board') return {
      ...base, role: 'board', field: BOW_FIELD,
      targets: world.targets.map((target) => ({ ...target, center: { ...target.center } })),
      players: Object.values(world.players).map((player) => ({
        id: player.id, origin: { ...player.origin }, aim: { ...player.aim }, score: player.score,
        reloadUntilMs: session.startsAt! + this.skippedMs + player.reloadUntilMs,
      })),
      arrows: world.arrows.map((arrow) => ({
        id: arrow.id, playerId: arrow.playerId, position: { ...arrow.position }, angle: arrow.angle,
        state: arrow.state, tailKick: arrow.tailKick,
      })),
    }
    const player = playerId ? world.players[playerId] : undefined
    if (!player) return { ...base, role: 'spectator' }
    return {
      ...base, role: 'player',
      player: {
        id: player.id, origin: { ...player.origin }, aim: { ...player.aim }, score: player.score,
        reloadUntilMs: session.startsAt! + this.skippedMs + player.reloadUntilMs,
      },
      trajectory: sampleBowTrajectory(world, player.id, 18),
    }
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

  private resetTransient(clearCompleted = true): void {
    this.world = null
    this.pendingAim.clear()
    this.pendingRelease = []
    this.dispositions.clear()
    this.accumulator = 0
    this.skippedMs = 0
    if (clearCompleted) this.completed = false
  }
}
