import type { TankCrew } from '../../../shared/protocol.ts'
import type { Vec2 } from '../bow/types.ts'

export const TANK_STEP_MS = 1000 / 60
export const TANK_FIELD = { width: 1600, height: 900 } as const
export const CELL = 10
export const COLS = 160
export const ROWS = 90
export const TANK_RADIUS = 22

export type Weapon = 'gun' | 'cannon'

export type WeaponConfig = {
  damage: number
  clip: number
  intervalMs: number
  reloadMs: number
  blastRadius: number
  speed: number
  lifetimeMs: number
}

export type TankConfig = {
  hp: number
  forwardSpeed: number
  backwardSpeed: number
  radiansPerTurn: number
  muzzle: number
  gun: WeaponConfig
  cannon: WeaponConfig
  splash: number
  respawnMs: number
  invulnerableMs: number
  killPoints: number
  ceaseFireMs: number
}

export type Tank = {
  id: string
  crew: TankCrew
  position: Vec2
  hull: number
  turret: number
  hullTarget: number | null
  turretTarget: number | null
  hullTurnRate: number
  turretTurnRate: number
  hullTurnUntilMs: number
  turretTurnUntilMs: number
  hp: number
  drive: -1 | 0 | 1
  gunHeld: boolean
  gunClip: number
  gunNextShotMs: number
  gunReloadUntilMs: number
  cannonClip: number
  cannonReloadUntilMs: number
  deadUntilMs: number | null
  invulnerableUntilMs: number
  score: number
  shots: number
}

export type Projectile = {
  id: string
  tankId: string
  weapon: Weapon
  position: Vec2
  velocity: Vec2
  bornAtMs: number
}

export type Blast = { position: Vec2; radius: number; weapon: Weapon }

export type TankWorld = {
  seed: number
  tick: number
  nowMs: number
  nextProjectile: number
  config: TankConfig
  cover: Uint8Array
  coverChanged: number[]
  nextFullCoverTick: number
  spawns: Vec2[]
  tanks: Tank[]
  projectiles: Projectile[]
  blasts: Blast[]
}
