export const BOW_STEP_MS = 1000 / 60
export const BOW_FIELD = { width: 1600, height: 900 } as const

export type Vec2 = { x: number; y: number }
export type BowAim = { angle: number; tension: number }
export type BowTarget = { id: string; center: Vec2; radius: number }

export type BowArrow = {
  id: string
  playerId: string
  position: Vec2
  previous: Vec2
  velocity: Vec2
  angle: number
  bornAtMs: number
  lodgedAtMs?: number
  state: 'flying' | 'lodged-target' | 'lodged-boundary'
  targetId?: string
  tailKick: number
}

export type BowPlayer = {
  id: string
  origin: Vec2
  aim: BowAim
  reloadUntilMs: number
  score: number
  shots: number
}

export type BowConfig = {
  reloadMs: number
  gravity: number
  minSpeed: number
  maxSpeed: number
  flyingLifetimeMs: number
  lodgedLifetimeMs: number
  entityCap: number
}

export type BowWorld = {
  seed: number
  tick: number
  nowMs: number
  nextArrow: number
  config: BowConfig
  players: Record<string, BowPlayer>
  targets: BowTarget[]
  arrows: BowArrow[]
}

export type CreateBowWorld = {
  seed: number
  playerIds: string[]
  targets?: BowTarget[]
  config?: Partial<BowConfig>
}

export type BowCommandResult =
  | { status: 'applied' | 'unchanged' }
  | { status: 'refused'; reason: 'unknown-player' | 'invalid-aim' }

export type BowReleaseResult =
  | { status: 'accepted'; arrowId: string; reloadUntilMs: number }
  | { status: 'refused'; reason: 'unknown-player' | 'reloading' | 'capacity' }
