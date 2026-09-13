import { add, sub, scale, dot, length, normalize, segmentCircleHit, sweptSegmentHit, tipCapsuleHit } from './geometry.ts'
import { BOW_FIELD, BOW_STEP_MS } from './types.ts'
import type {
  BowResult, BowArrow, Vec2, BowAim, BowCommandResult, BowConfig, BowPlayer, BowReleaseResult,
  BowTarget, BowWorld, CreateBowWorld,
} from './types.ts'

const DEFAULT_CONFIG: Readonly<BowConfig> = {
  reloadMs: 100,
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

  const { velocity, position } = launchBow(player, world.config)
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

function launchBow(player: BowPlayer, config: BowConfig): { position: Vec2; velocity: Vec2 } {
  const fromUp = player.aim.angle * 65 * Math.PI / 180
  const speed = config.minSpeed + (config.maxSpeed - config.minSpeed) * player.aim.tension
  const velocity = { x: Math.sin(fromUp) * speed, y: -Math.cos(fromUp) * speed }
  const position = { x: player.origin.x, y: player.origin.y - 20 }
  return { position, velocity }
}

type SurfaceHit = { t: number; point: Vec2; target?: BowTarget; bottom?: boolean }

// Treat an already-outside tip as immediate contact.
function outsideField(point: Vec2): SurfaceHit | null {
  if (point.y > BOW_FIELD.height) return { t: 0, point: { ...point }, bottom: true }
  if (point.x < 0 || point.x > BOW_FIELD.width || point.y < 0) return {
    t: 0, point: { x: Math.max(0, Math.min(BOW_FIELD.width, point.x)), y: Math.max(0, point.y) },
  }
  return null
}

function surfaceHit(world: BowWorld, start: Vec2, velocity: Vec2, seconds: number): SurfaceHit | null {
  const outside = outsideField(start)
  if (outside) return outside
  const end = { x: start.x + velocity.x * seconds, y: start.y + velocity.y * seconds }
  let first: SurfaceHit | null = null
  const take = (hit: SurfaceHit) => {
    if (hit.t >= 0 && hit.t <= 1 && (!first || hit.t < first.t)) first = hit
  }
  // Boundaries win exact ties; target ties use ids, never caller array order.
  for (const [axis, edge, bottom] of [
    ['x', 0, false], ['x', BOW_FIELD.width, false],
    ['y', 0, false], ['y', BOW_FIELD.height, true],
  ] as const) {
    const speed = velocity[axis]
    if (speed === 0 || (edge === 0 ? speed > 0 : speed < 0)) continue
    if (start[axis] === edge) {
      take({ t: 0, point: { ...start }, bottom })
      continue
    }
    const delta = end[axis] - start[axis]
    if (delta === 0) continue
    const t = (edge - start[axis]) / delta
    const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
    point[axis] = edge
    take({ t, point, bottom })
  }
  for (const target of [...world.targets].sort((a, b) => lexical(a.id, b.id))) {
    const hit = segmentCircleHit(start, end, target.center, target.radius)
    if (hit) take({ t: hit.t, point: hit.point, target })
  }
  return first
}

const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

function lodge(world: BowWorld, arrow: BowArrow, hit: SurfaceHit): void {
  if (hit.target) {
    const { center, radius, id } = hit.target
    const speed = Math.hypot(arrow.velocity.x, arrow.velocity.y)
    const miss = speed === 0 ? Math.hypot(center.x - arrow.position.x, center.y - arrow.position.y)
      : Math.abs((center.x - arrow.position.x) * arrow.velocity.y
        - (center.y - arrow.position.y) * arrow.velocity.x) / speed
    world.players[arrow.playerId].score += miss <= 0.28 * radius ? 30 : miss <= 0.62 * radius ? 20 : 10
    arrow.targetId = id
    arrow.state = 'lodged-target'
  } else {
    arrow.state = 'lodged-boundary'
  }
  arrow.position = hit.point
  arrow.velocity = { x: 0, y: 0 }
  arrow.lodgedAtMs = world.nowMs
}

const SHAFT_LENGTH = 48
const PAIR_RADIUS = 8 // Two radius-4 shafts in flight.
const TIP_RADIUS = 4 // A flying tip point against a stuck radius-4 shaft.
const RESTITUTION = 0.35
const tail = (arrow: BowArrow): Vec2 => ({
  x: arrow.position.x - SHAFT_LENGTH * Math.cos(arrow.angle),
  y: arrow.position.y - SHAFT_LENGTH * Math.sin(arrow.angle),
})
const motion = (arrow: BowArrow): Vec2 => arrow.state === 'flying' ? arrow.velocity : { x: 0, y: 0 }

// Arrows in flight collide shaft to shaft. A flying arrow meets a stuck one only
// with its tip, as `a`; the normal points from `b` toward `a`.
function collide(a: BowArrow, b: BowArrow, normal: Vec2): number {
  const aFree = a.state === 'flying', bFree = b.state === 'flying'
  const relativeNormal = dot(sub(motion(a), motion(b)), normal)
  if (relativeNormal < 0) {
    const impulse = -(1 + RESTITUTION) * relativeNormal / (Number(aFree) + Number(bFree))
    const speedA = length(a.velocity), speedB = length(b.velocity)
    if (aFree) a.velocity = add(a.velocity, scale(normal, impulse))
    if (bFree) b.velocity = sub(b.velocity, scale(normal, impulse))
    if (!aFree || !bFree) {
      const flying = aFree ? a : b, fixed = aFree ? b : a
      // Restitution chooses the reflected direction; total retained speed is 80%.
      flying.velocity = scale(normalize(flying.velocity), 0.8 * (aFree ? speedA : speedB))
      fixed.tailKick = Math.max(-1, Math.min(1, fixed.tailKick + (aFree ? 1 : -1) * impulse / 1500))
    }
  }
  if (aFree) a.angle = Math.atan2(a.velocity.y, a.velocity.x)
  if (bFree) b.angle = Math.atan2(b.velocity.y, b.velocity.x)
  // Return each free arrow's separation distance for a surface sweep. A tip
  // clears the stuck shaft; reorienting shafts in flight can put a tail through
  // the other, so both whole shafts clear.
  const bMax = Math.max(dot(b.position, normal), dot(tail(b), normal))
  const separation = aFree && bFree
    ? Math.max(0, PAIR_RADIUS + 1e-7 - (Math.min(dot(a.position, normal), dot(tail(a), normal)) - bMax))
    : Math.max(0, TIP_RADIUS + 1e-7 - (dot(a.position, normal) - bMax))
  return separation / (Number(aFree) + Number(bFree))
}

type Contact =
  | { t: number; arrow: BowArrow; surface: SurfaceHit }
  | { t: number; a: BowArrow; b: BowArrow; normal: Vec2; key: string }

export function stepBow(world: BowWorld): void {
  const dt = BOW_STEP_MS / 1000
  world.tick++
  // Derive time from ticks so repeated addition cannot delay a reload by a tick.
  world.nowMs = world.tick * BOW_STEP_MS
  // A tiny time tolerance keeps exact tick lifetimes from slipping one tick
  // through floating-point addition. Legacy explicit fixtures may omit lodgedAtMs.
  world.arrows = world.arrows.filter(arrow => {
    const flying = arrow.state === 'flying'
    const start = flying ? arrow.bornAtMs : arrow.lodgedAtMs ?? arrow.bornAtMs
    const lifetime = flying ? world.config.flyingLifetimeMs : world.config.lodgedLifetimeMs
    return world.nowMs + 1e-9 < start + lifetime
  })
  const arrows = [...world.arrows].sort((a, b) => lexical(a.id, b.id))
  for (const arrow of arrows) {
    if (arrow.state !== 'flying') {
      arrow.tailKick *= 0.85
      continue
    }
    arrow.previous = { ...arrow.position }
    arrow.velocity.y += world.config.gravity * dt
    arrow.angle = Math.atan2(arrow.velocity.y, arrow.velocity.x)
  }
  const removed = new Set<BowArrow>()
  const paired = new Set<string>()
  let remaining = dt
  // Each event either settles/removes an arrow or consumes an unordered pair.
  // Recompute after impacts so a deflection cannot score on its old path.
  // Drain zero-time contacts too, including ties at the very end of the tick.
  while (true) {
    let first: Contact | null = null
    for (const arrow of arrows) {
      if (removed.has(arrow) || arrow.state !== 'flying') continue
      const hit = surfaceHit(world, arrow.position, arrow.velocity, remaining)
      if (hit && (!first || hit.t < first.t)) first = { t: hit.t, arrow, surface: hit }
    }
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i]
      if (removed.has(a)) continue
      for (let j = i + 1; j < arrows.length; j++) {
        const b = arrows[j], key = `${i}:${j}`
        if (removed.has(b) || paired.has(key) || (a.state !== 'flying' && b.state !== 'flying')) continue
        if (a.state === 'flying' && b.state === 'flying') {
          const hit = sweptSegmentHit(a.position, tail(a), scale(a.velocity, remaining),
            b.position, tail(b), scale(b.velocity, remaining), PAIR_RADIUS)
          if (hit && (!first || hit.t < first.t)) first = { ...hit, a, b, key }
          continue
        }
        const [flyer, fixed] = a.state === 'flying' ? [a, b] : [b, a]
        const hit = tipCapsuleHit(flyer.position, scale(flyer.velocity, remaining), fixed.position, tail(fixed), TIP_RADIUS)
        if (hit && (!first || hit.t < first.t)) first = { ...hit, a: flyer, b: fixed, key }
      }
    }
    const elapsed = remaining * (first?.t ?? 1)
    for (const arrow of arrows) {
      if (removed.has(arrow) || arrow.state !== 'flying') continue
      arrow.position.x += arrow.velocity.x * elapsed
      arrow.position.y += arrow.velocity.y * elapsed
    }
    if (!first) break
    remaining -= elapsed
    if ('surface' in first) {
      if (first.surface.bottom) removed.add(first.arrow)
      else lodge(world, first.arrow, first.surface)
    } else {
      paired.add(first.key)
      const share = collide(first.a, first.b, first.normal)
      // Separation is instantaneous, but its tip path must still stop at the
      // earliest surface. Keep the reflected velocity for lodging and scoring.
      for (const [arrow, sign] of [[first.a, 1], [first.b, -1]] as const) {
        if (arrow.state !== 'flying') continue
        const delta = scale(first.normal, sign * share)
        const hit = surfaceHit(world, arrow.position, delta, 1)
        if (hit?.bottom) removed.add(arrow)
        else if (hit) lodge(world, arrow, hit)
        else arrow.position = add(arrow.position, delta)
      }
    }
  }
  world.arrows = world.arrows.filter(arrow => !removed.has(arrow))
}

// One future fixed-step position per sample, excluding the launch point.
// Preview is ballistic: reload, obstacles, scoring, and lifetime do not affect it.
export function sampleBowTrajectory(world: BowWorld, playerId: string, count: number): Vec2[] {
  if (!Object.hasOwn(world.players, playerId) || !Number.isFinite(count)) return []
  const { position, velocity } = launchBow(world.players[playerId], world.config)
  const samples: Vec2[] = []
  const dt = BOW_STEP_MS / 1000
  for (let i = 0; i < Math.min(24, Math.floor(count)); i++) {
    velocity.y += world.config.gravity * dt
    position.x += velocity.x * dt
    position.y += velocity.y * dt
    samples.push({ ...position })
  }
  return samples
}

export function bowResults(world: BowWorld): BowResult[] {
  return Object.values(world.players).map(player => ({
    playerId: player.id, points: player.score, shots: player.shots,
  })).sort((a, b) => b.points - a.points || a.shots - b.shots || lexical(a.playerId, b.playerId))
}
