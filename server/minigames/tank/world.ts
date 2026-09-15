import type { MinigameResult, TankCrew, TankInput } from '../../../shared/protocol.ts'
import type { Vec2 } from '../bow/types.ts'
import type { InputOutcome } from '../definition.ts'
import { SPAWNS, carve, circleHitsCover, createCover, solidAt } from './cover.ts'
import { TANK_FIELD, TANK_RADIUS, TANK_STEP_MS } from './types.ts'
import type { Projectile, Tank, TankConfig, TankWorld, Weapon } from './types.ts'

export const DEFAULT_TANK_CONFIG: Readonly<TankConfig> = {
  hp: 100,
  forwardSpeed: 160,
  backwardSpeed: 100,
  radiansPerTurn: Math.PI / 2,
  muzzle: 30,
  gun: { damage: 5, clip: 20, intervalMs: 100, reloadMs: 2_000, blastRadius: 8, speed: 900, lifetimeMs: 1_500 },
  cannon: { damage: 30, clip: 1, intervalMs: 0, reloadMs: 3_000, blastRadius: 40, speed: 600, lifetimeMs: 2_500 },
  splash: 20,
  respawnMs: 3_000,
  invulnerableMs: 2_000,
  killPoints: 50,
  ceaseFireMs: Infinity,
}

// Tick times are multiples of a repeating fraction; compare deadlines with a tolerance.
const reached = (world: TankWorld, ms: number) => world.nowMs + 1e-6 >= ms
const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))

export function formCrews(random: () => number, participants: string[]): TankCrew[] {
  const order = [...participants].sort()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const crews: TankCrew[] = []
  for (let i = 0; i < order.length; i += 2) {
    crews.push({ id: `crew-${i / 2}`, driver: order[i], gunner: order[i + 1] ?? order[i] })
  }
  return crews
}

// ponytail: more than 8 tanks reuse spawn points shifted sideways; add spawns if rooms get that big.
export function spawnPoint(spawns: Vec2[], index: number): Vec2 {
  const base = spawns[index % spawns.length]
  const lap = Math.floor(index / spawns.length)
  return { x: base.x + lap * 60 * (base.x < TANK_FIELD.width / 2 ? 1 : -1), y: base.y }
}

export const facingCenter = (p: Vec2) => Math.atan2(TANK_FIELD.height / 2 - p.y, TANK_FIELD.width / 2 - p.x)

export function createTankWorld(input: {
  seed: number
  crews: TankCrew[]
  config?: Partial<TankConfig>
  cover?: Uint8Array
}): TankWorld {
  const config = { ...DEFAULT_TANK_CONFIG, ...input.config }
  const tanks: Tank[] = input.crews.map((crew, index) => {
    const position = spawnPoint(SPAWNS, index)
    return {
      id: crew.id, crew, position, hull: facingCenter(position), turret: 0, hp: config.hp,
      drive: 0, gunHeld: false,
      gunClip: config.gun.clip, gunNextShotMs: 0, gunReloadUntilMs: 0,
      cannonClip: config.cannon.clip, cannonReloadUntilMs: 0,
      deadUntilMs: null, invulnerableUntilMs: 0, score: 0, shots: 0,
    }
  })
  return {
    seed: input.seed, tick: 0, nowMs: 0, nextProjectile: 0, config,
    cover: input.cover ?? createCover(input.seed, SPAWNS),
    coverChanged: [], nextFullCoverTick: 0, spawns: SPAWNS,
    tanks, projectiles: [], blasts: [],
  }
}

export const tankOf = (world: TankWorld, playerId: string) =>
  world.tanks.find((tank) => tank.crew.driver === playerId || tank.crew.gunner === playerId)

export const gunDirection = (tank: Tank) => tank.hull + tank.turret

export function applyTankInput(world: TankWorld, playerId: string, input: TankInput): InputOutcome {
  const tank = tankOf(world, playerId)
  if (!tank) return { status: 'refused', reason: 'not-participant' }
  const driver = tank.crew.driver === playerId
  const gunner = tank.crew.gunner === playerId

  if (input.kind === 'wheel') {
    const part = driver && gunner ? input.part : driver ? 'hull' : 'turret'
    if (part !== 'hull' && part !== 'turret') return { status: 'refused', reason: 'invalid' }
    const radians = Math.max(-4, Math.min(4, input.turns)) * world.config.radiansPerTurn
    tank[part] = wrap(tank[part] + radians)
    return { status: 'accepted' }
  }
  if (input.kind === 'drive') {
    if (!driver) return { status: 'refused', reason: 'invalid' }
    tank.drive = input.dir
    return { status: 'accepted' }
  }
  if (!gunner) return { status: 'refused', reason: 'invalid' }
  if (input.weapon === 'gun') {
    tank.gunHeld = input.down
    return { status: 'accepted' }
  }
  if (!input.down) return { status: 'accepted' }
  if (world.nowMs >= world.config.ceaseFireMs) return { status: 'refused', reason: 'not-playing' }
  if (tank.deadUntilMs !== null) return { status: 'refused', reason: 'destroyed' }
  if (tank.cannonClip === 0) return { status: 'refused', reason: 'reloading' }
  fire(world, tank, 'cannon')
  return { status: 'accepted' }
}

function fire(world: TankWorld, tank: Tank, weapon: Weapon): void {
  const spec = world.config[weapon]
  const angle = gunDirection(tank)
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  world.projectiles.push({
    id: `shot-${world.nextProjectile++}`,
    tankId: tank.id,
    weapon,
    position: { x: tank.position.x + dir.x * world.config.muzzle, y: tank.position.y + dir.y * world.config.muzzle },
    velocity: { x: dir.x * spec.speed, y: dir.y * spec.speed },
    bornAtMs: world.nowMs,
  })
  tank.shots++
  if (weapon === 'gun') {
    tank.gunClip--
    tank.gunNextShotMs = world.nowMs + spec.intervalMs
    if (tank.gunClip === 0) tank.gunReloadUntilMs = world.nowMs + spec.reloadMs
  } else {
    tank.cannonClip--
    tank.cannonReloadUntilMs = world.nowMs + spec.reloadMs
  }
}

function reload(world: TankWorld, tank: Tank): void {
  if (tank.gunClip === 0 && reached(world, tank.gunReloadUntilMs)) tank.gunClip = world.config.gun.clip
  if (tank.cannonClip === 0 && reached(world, tank.cannonReloadUntilMs)) tank.cannonClip = world.config.cannon.clip
}

function damage(world: TankWorld, shooter: Tank, victim: Tank, amount: number): void {
  if (amount <= 0 || victim.deadUntilMs !== null || world.nowMs < victim.invulnerableUntilMs) return
  const dealt = Math.min(amount, victim.hp)
  victim.hp -= dealt
  if (shooter !== victim) shooter.score += dealt
  if (victim.hp > 0) return
  victim.deadUntilMs = world.nowMs + world.config.respawnMs
  if (shooter !== victim) shooter.score += world.config.killPoints
}

function explode(world: TankWorld, at: Vec2, shot: Projectile, direct: Tank | undefined): void {
  const spec = world.config[shot.weapon]
  world.coverChanged.push(...carve(world.cover, at, spec.blastRadius))
  world.blasts.push({ position: { ...at }, radius: spec.blastRadius, weapon: shot.weapon })
  const shooter = world.tanks.find((tank) => tank.id === shot.tankId)!
  if (direct) damage(world, shooter, direct, spec.damage)
  if (shot.weapon !== 'cannon') return
  for (const tank of world.tanks) {
    if (tank === direct) continue
    const reach = Math.max(0, Math.hypot(tank.position.x - at.x, tank.position.y - at.y) - TANK_RADIUS)
    if (reach < spec.blastRadius) damage(world, shooter, tank, Math.round(world.config.splash * (1 - reach / spec.blastRadius)))
  }
}

function flyProjectiles(world: TankWorld, dt: number): void {
  const flying: Projectile[] = []
  for (const shot of world.projectiles) {
    if (reached(world, shot.bornAtMs + world.config[shot.weapon].lifetimeMs)) {
      explode(world, shot.position, shot, undefined)
      continue
    }
    // ponytail: point samples every 4 px, not a swept test; enough for 22 px tanks and 10 px cells.
    const samples = Math.max(1, Math.ceil(Math.hypot(shot.velocity.x, shot.velocity.y) * dt / 4))
    let burst = false
    for (let i = 1; i <= samples && !burst; i++) {
      const p = { x: shot.position.x + shot.velocity.x * dt * i / samples, y: shot.position.y + shot.velocity.y * dt * i / samples }
      const outside = p.x < 0 || p.y < 0 || p.x >= TANK_FIELD.width || p.y >= TANK_FIELD.height
      const hit = world.tanks.find((tank) => tank.id !== shot.tankId && tank.deadUntilMs === null
        && Math.hypot(tank.position.x - p.x, tank.position.y - p.y) < TANK_RADIUS)
      if (outside || hit || solidAt(world.cover, p)) {
        const at = { x: Math.max(0, Math.min(TANK_FIELD.width - 1e-6, p.x)), y: Math.max(0, Math.min(TANK_FIELD.height - 1e-6, p.y)) }
        explode(world, at, shot, hit)
        burst = true
      }
    }
    if (!burst) {
      shot.position = { x: shot.position.x + shot.velocity.x * dt, y: shot.position.y + shot.velocity.y * dt }
      flying.push(shot)
    }
  }
  world.projectiles = flying
}

function respawn(world: TankWorld, tank: Tank): void {
  if (tank.deadUntilMs === null || !reached(world, tank.deadUntilMs)) return
  const enemies = world.tanks.filter((other) => other !== tank && other.deadUntilMs === null)
  const clearance = (p: Vec2) => enemies.length === 0 ? 0
    : Math.min(...enemies.map((enemy) => Math.hypot(enemy.position.x - p.x, enemy.position.y - p.y)))
  const spot = world.spawns.reduce((best, spawn) => clearance(spawn) > clearance(best) ? spawn : best)
  const { config } = world
  Object.assign(tank, {
    position: { ...spot }, hull: facingCenter(spot), turret: 0, hp: config.hp,
    gunClip: config.gun.clip, gunNextShotMs: 0, gunReloadUntilMs: 0,
    cannonClip: config.cannon.clip, cannonReloadUntilMs: 0,
    deadUntilMs: null, invulnerableUntilMs: world.nowMs + config.invulnerableMs,
  })
}

export function tankResults(world: TankWorld): MinigameResult[] {
  return world.tanks
    .flatMap((tank) => [...new Set([tank.crew.driver, tank.crew.gunner])]
      .map((playerId) => ({ playerId, points: tank.score, shots: tank.shots })))
    .sort((a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : 1))
}

function blocked(world: TankWorld, tank: Tank, next: Vec2): boolean {
  const r = TANK_RADIUS
  if (next.x < r || next.y < r || next.x > TANK_FIELD.width - r || next.y > TANK_FIELD.height - r) return true
  if (circleHitsCover(world.cover, next, r)) return true
  // An overlapping pair may still move apart, so a respawn on top of a tank never locks both.
  return world.tanks.some((other) => {
    if (other === tank || other.deadUntilMs !== null) return false
    const after = Math.hypot(other.position.x - next.x, other.position.y - next.y)
    return after < 2 * r && after < Math.hypot(other.position.x - tank.position.x, other.position.y - tank.position.y)
  })
}

function move(world: TankWorld, tank: Tank, dt: number): void {
  if (tank.drive === 0) return
  const speed = tank.drive > 0 ? world.config.forwardSpeed : -world.config.backwardSpeed
  const dx = Math.cos(tank.hull) * speed * dt
  const dy = Math.sin(tank.hull) * speed * dt
  const { x, y } = tank.position
  // Slide along whatever blocks one axis.
  for (const next of [{ x: x + dx, y: y + dy }, { x: x + dx, y }, { x, y: y + dy }]) {
    if (!blocked(world, tank, next)) {
      tank.position = next
      return
    }
  }
}

export function stepTank(world: TankWorld): void {
  const dt = TANK_STEP_MS / 1000
  world.tick++
  world.nowMs = world.tick * TANK_STEP_MS
  for (const tank of world.tanks) {
    respawn(world, tank)
    reload(world, tank)
    if (tank.deadUntilMs !== null) continue
    move(world, tank, dt)
    if (tank.gunHeld && tank.gunClip > 0 && world.nowMs < world.config.ceaseFireMs && reached(world, tank.gunNextShotMs)) fire(world, tank, 'gun')
  }
  flyProjectiles(world, dt)
}
