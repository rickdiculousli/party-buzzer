import { BOW_FIELD, BOW_STEP_MS } from './types.ts'
import type {
  BowAim, BowCommandResult, BowConfig, BowPlayer, BowReleaseResult,
  BowTarget, BowWorld, CreateBowWorld,
} from './types.ts'

const DEFAULT_CONFIG: Readonly<BowConfig> = {
  reloadMs: 700,
  gravity: 980,
  minSpeed: 700,
  maxSpeed: 1500,
  flyingLifetimeMs: 6000,
  lodgedLifetimeMs: 12000,
  entityCap: 256,
}

const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = seed + 0x6d2b79f5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

function createTargets(seed: number, players: BowPlayer[]): BowTarget[] {
  const random = mulberry32(seed)
  const targets: BowTarget[] = []
  const laneWidth = BOW_FIELD.width / 5
  for (let lane = 0; lane < 5; lane++) {
    // The fallback fits entirely inside its lane and stays well above bows.
    let target: BowTarget = {
      id: `target-${lane}`, center: { x: (lane + 0.5) * laneWidth, y: 280 }, radius: 50,
    }
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate: BowTarget = {
        id: target.id,
        center: { x: lane * laneWidth + 80 + random() * (laneWidth - 160), y: 120 + random() * 320 },
        radius: 40 + random() * 20,
      }
      if (targets.some(other => Math.hypot(
        candidate.center.x - other.center.x, candidate.center.y - other.center.y,
      ) <= candidate.radius + other.radius)) continue
      if (players.some(player => Math.hypot(
        candidate.center.x - player.origin.x, candidate.center.y - player.origin.y,
      ) <= candidate.radius)) continue
      target = candidate
      break
    }
    targets.push(target)
  }
  return targets
}

export function createBowWorld(input: CreateBowWorld): BowWorld {
  const ids = [...new Set(input.playerIds)].sort()
  const players: Record<string, BowPlayer> = Object.fromEntries(ids.map((id, index) => [id, {
    id,
    origin: { x: BOW_FIELD.width * (index + 1) / (ids.length + 1), y: 850 },
    aim: { angle: 0, tension: 0 },
    reloadUntilMs: 0,
    score: 0,
    shots: 0,
  }]))
  return {
    seed: input.seed,
    tick: 0,
    nowMs: 0,
    nextArrow: 0,
    config: { ...DEFAULT_CONFIG, ...input.config },
    players,
    targets: input.targets?.map(target => ({ ...target, center: { ...target.center } }))
      ?? createTargets(input.seed, Object.values(players)),
    arrows: [],
  }
}

export function setBowAim(world: BowWorld, playerId: string, aim: BowAim): BowCommandResult {
  if (!Object.hasOwn(world.players, playerId)) return { status: 'refused', reason: 'unknown-player' }
  if (!Number.isFinite(aim.angle) || !Number.isFinite(aim.tension)) {
    return { status: 'refused', reason: 'invalid-aim' }
  }
  const angle = Math.max(-1, Math.min(1, aim.angle))
  const tension = Math.max(0, Math.min(1, aim.tension))
  const player = world.players[playerId]
  if (player.aim.angle === angle && player.aim.tension === tension) return { status: 'unchanged' }
  player.aim = { angle, tension }
  return { status: 'applied' }
}

export function releaseBow(world: BowWorld, playerId: string): BowReleaseResult {
  if (!Object.hasOwn(world.players, playerId)) return { status: 'refused', reason: 'unknown-player' }
  const player = world.players[playerId]
  if (world.nowMs < player.reloadUntilMs) return { status: 'refused', reason: 'reloading' }
  if (world.arrows.length >= world.config.entityCap) return { status: 'refused', reason: 'capacity' }

  const fromUp = player.aim.angle * 65 * Math.PI / 180
  const speed = world.config.minSpeed + (world.config.maxSpeed - world.config.minSpeed) * player.aim.tension
  const velocity = { x: Math.sin(fromUp) * speed, y: -Math.cos(fromUp) * speed }
  const position = { x: player.origin.x, y: player.origin.y - 20 }
  const arrowId = `arrow-${world.nextArrow++}`
  world.arrows.push({
    id: arrowId,
    playerId,
    position,
    previous: { ...position },
    velocity,
    angle: Math.atan2(velocity.y, velocity.x),
    bornAtMs: world.nowMs,
    state: 'flying',
    tailKick: 0,
  })
  player.shots++
  player.reloadUntilMs = world.nowMs + world.config.reloadMs
  return { status: 'accepted', arrowId, reloadUntilMs: player.reloadUntilMs }
}

export function stepBow(world: BowWorld): void {
  const dt = BOW_STEP_MS / 1000
  for (const arrow of world.arrows) {
    if (arrow.state !== 'flying') continue
    arrow.previous = { ...arrow.position }
    arrow.velocity.y += world.config.gravity * dt
    arrow.position.x += arrow.velocity.x * dt
    arrow.position.y += arrow.velocity.y * dt
    arrow.angle = Math.atan2(arrow.velocity.y, arrow.velocity.x)
  }
  world.tick++
  // Derive time from ticks so repeated addition cannot delay a reload by a tick.
  world.nowMs = world.tick * BOW_STEP_MS
}
