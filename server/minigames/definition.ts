import type { HostRow, MinigameCheckpoint, MinigameInputAck, MinigameLobby, MinigameResult, PlayerId, State, TankCrew } from '../../shared/protocol.ts'
import type { Refusal } from '../../shared/legality.ts'

export type InputOutcome =
  | { status: 'accepted' }
  | { status: 'refused'; reason: NonNullable<MinigameInputAck['reason']> }

export type Clock = (worldMs: number) => number

export type MinigameRoom = Pick<State, 'grouping' | 'players' | 'teams' | 'scores'>

export type TouchAudience = { players: PlayerId[]; board: boolean }

export type MinigameDefinition<W> = {
  stepMs: number
  create(seed: number, participants: string[], options: Record<string, number>, lobby: MinigameLobby, room?: MinigameRoom): { world: W; crews?: TankCrew[] }
  untimed?: true
  finished?(world: W): boolean
  prepare?(): Refusal | null
  startable?(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null
  touchAudience?(world: W, playerId: PlayerId, target: string): TouchAudience | null
  classify(input: unknown): 'continuous' | 'discrete' | null
  apply(world: W, playerId: string, input: any): InputOutcome
  step(world: W): void
  afterFrame?(world: W): void
  tick(world: W): number
  frameKey?(world: W): string | number
  boardFrame(world: W, clock: Clock): object
  playerFrame(world: W, playerId: string, clock: Clock): object | null
  results(world: W): MinigameResult[]
  checkpoint?(world: W): MinigameCheckpoint | null
  resume?(data: unknown, options: Record<string, number>): { world: W; participants: PlayerId[] }
  presence?(world: W, connected: PlayerId[]): void
  hostStatus?(world: W, clock: Clock): { text: string; until?: number }[]
  hostRows?(world: W, clock: Clock): HostRow[]
}

export function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
