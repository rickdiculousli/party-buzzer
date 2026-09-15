import type { TankCrew } from '../../../shared/protocol.ts'
import type { Vec2 } from '../bow/types.ts'

export const TANK_STEP_MS = 1000 / 60
export const TANK_FIELD = { width: 1600, height: 900 } as const
export const CELL = 10
export const COLS = 160
export const ROWS = 90
// ponytail: tanks collide and take hits as circles; use oriented boxes if glancing hits feel wrong.
export const TANK_RADIUS = 22

export type Weapon = 'gun' | 'cannon'

export type WeaponConfig = {
  damage: number
  clip: number
  /** Minimum time between shots while loaded. */
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
  /** Projectiles spawn this far along the gun from the tank center. */
  muzzle: number
  gun: WeaponConfig
  cannon: WeaponConfig
  /** Cannon splash damage at the blast center, falling to zero at its radius. */
  splash: number
  respawnMs: number
  invulnerableMs: number
  killPoints: number
  /** World time after which no weapon fires; the landing grace still runs. */
  ceaseFireMs: number
}

export type Tank = {
  /** The crew id. */
  id: string
  crew: TankCrew
  position: Vec2
  /** Radians, 0 = +x, clockwise on screen. */
  hull: number
  /** Radians relative to the hull. */
  turret: number
  hp: number
  drive: -1 | 0 | 1
  gunHeld: boolean
  gunClip: number
  gunNextShotMs: number
  gunReloadUntilMs: number
  cannonClip: number
  cannonReloadUntilMs: number
  /** Set while destroyed. */
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
  /** Row-major, 1 = solid cover. */
  cover: Uint8Array
  /** Cells cleared since the last broadcast. */
  coverChanged: number[]
  /** The first tick whose board frame carries the whole grid again. */
  nextFullCoverTick: number
  spawns: Vec2[]
  tanks: Tank[]
  projectiles: Projectile[]
  /** Explosions since the last broadcast. */
  blasts: Blast[]
}
