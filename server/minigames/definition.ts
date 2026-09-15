import type { MinigameInputAck, MinigameResult, TankCrew } from '../../shared/protocol.ts'

export type InputOutcome =
  | { status: 'accepted' }
  | { status: 'refused'; reason: NonNullable<MinigameInputAck['reason']> }

/** Maps a world time in ms to server time. */
export type Clock = (worldMs: number) => number

/**
 * Everything the runtime needs from one minigame. The runtime owns lifecycle,
 * clocks, input queueing, dispositions and acks.
 */
export type MinigameDefinition<W> = {
  stepMs: number
  /** Game-specific numeric options; the runtime sanitizes durationSec and seed. */
  options(raw: Record<string, unknown>): Record<string, number>
  create(seed: number, participants: string[], options: Record<string, number>): { world: W; crews?: TankCrew[] }
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
  boardFrame(world: W, clock: Clock): object
  /** Null for a spectator. */
  playerFrame(world: W, playerId: string, clock: Clock): object | null
  results(world: W): MinigameResult[]
}

export function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
