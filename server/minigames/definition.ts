import type { MinigameCheckpoint, MinigameInputAck, MinigameLobby, MinigameResult, PlayerId, TankCrew } from '../../shared/protocol.ts'
import type { Refusal } from '../../shared/legality.ts'

export type InputOutcome =
  | { status: 'accepted' }
  | { status: 'refused'; reason: NonNullable<MinigameInputAck['reason']> }

/** Maps a world time in ms to server time. */
export type Clock = (worldMs: number) => number

/** Who sees a player's touch. */
export type TouchAudience = { players: PlayerId[]; board: boolean }

/**
 * Everything the runtime needs from one minigame. The runtime owns lifecycle,
 * clocks, input queueing, dispositions and acks.
 */
export type MinigameDefinition<W> = {
  stepMs: number
  /** Options arrive sanitized against `MINIGAME_OPTIONS`, plus durationSec and seed. */
  create(seed: number, participants: string[], options: Record<string, number>, lobby: MinigameLobby): { world: W; crews?: TankCrew[] }
  /** No clock: the match ends when `finished` returns true. */
  untimed?: true
  finished?(world: W): boolean
  /** Checked on prepare and again on start; a reason refuses the host action. */
  prepare?(): Refusal | null
  startable?(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null
  /** Who sees a player's touch. Null drops it. */
  touchAudience?(world: W, playerId: PlayerId, target: string): TouchAudience | null
  /**
   * `discrete` inputs are checked against the match window, fire once, and are
   * acknowledged. `continuous` inputs are applied in arrival order. Null drops a
   * malformed input. Discrete inputs carry a server-domain `at`.
   */
  classify(input: unknown): 'continuous' | 'discrete' | null
  apply(world: W, playerId: string, input: any): InputOutcome
  step(world: W): void
  /** Runs after each broadcast so per-frame accumulators can reset. */
  afterFrame?(world: W): void
  tick(world: W): number
  /** Opt into state-driven publication: unchanged keys need no frame. Exclude simulation ticks. */
  frameKey?(world: W): string | number
  boardFrame(world: W, clock: Clock): object
  /** Null for a spectator. */
  playerFrame(world: W, playerId: string, clock: Clock): object | null
  results(world: W): MinigameResult[]
  /** A durable summary to resume from; a new `version` is saved. */
  checkpoint?(world: W): MinigameCheckpoint | null
  /** Rebuilds a world from a saved checkpoint in place of `create`. */
  resume?(data: unknown, options: Record<string, number>): { world: W; participants: PlayerId[] }
  /** Who is connected, before each pump's steps. */
  presence?(world: W, connected: PlayerId[]): void
  /** Lines for the host desk; `until` is a world time in ms, which the runtime maps to server time. */
  hostStatus?(world: W, clock: Clock): { text: string; until?: number }[]
}

export function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
