import type { TankInput } from '../../../shared/protocol.ts'
import type { Clock, MinigameDefinition } from '../definition.ts'
import { encodeCover } from './cover.ts'
import { TANK_FIELD, TANK_STEP_MS, type Tank, type TankWorld, type Weapon } from './types.ts'
import { applyTankInput, createTankWorld, formCrews, stepTank, tankOf, tankResults } from './world.ts'

const FULL_COVER_EVERY_TICKS = 60
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

const projectTank = (world: TankWorld, tank: Tank) => ({
  id: tank.id, crew: tank.crew, position: { ...tank.position }, hull: tank.hull, turret: tank.turret,
  hp: tank.hp, dead: tank.deadUntilMs !== null, invulnerable: world.nowMs < tank.invulnerableUntilMs, score: tank.score,
})

const projectWeapon = (world: TankWorld, tank: Tank, weapon: Weapon, clock: Clock) => ({
  clip: weapon === 'gun' ? tank.gunClip : tank.cannonClip,
  size: world.config[weapon].clip,
  reloadUntil: clock(weapon === 'gun' ? tank.gunReloadUntilMs : tank.cannonReloadUntilMs),
  reloadMs: world.config[weapon].reloadMs,
})

export const tank: MinigameDefinition<TankWorld> = {
  stepMs: TANK_STEP_MS,
  options: () => ({}),
  create(seed, participants, options) {
    // Crews reshuffle on every start, while the seeded map stays the same for a replay.
    const crews = formCrews(Math.random, participants)
    return { world: createTankWorld({ seed, crews, config: { ceaseFireMs: options.durationSec * 1_000 } }), crews }
  },
  classify(input) {
    const i = input as { kind?: unknown; turns?: unknown; rate?: unknown; angle?: unknown; part?: unknown; dir?: unknown; weapon?: unknown; down?: unknown; at?: unknown } | null
    if (i?.kind === 'wheel') return finite(i.turns) && (i.part === undefined || i.part === 'hull' || i.part === 'turret') ? 'continuous' : null
    if (i?.kind === 'turn') return finite(i.rate) && (i.part === undefined || i.part === 'hull' || i.part === 'turret') ? 'continuous' : null
    if (i?.kind === 'turretAim') return finite(i.angle) ? 'continuous' : null
    if (i?.kind === 'drive') return i.dir === -1 || i.dir === 0 || i.dir === 1 ? 'continuous' : null
    if (i?.kind === 'trigger') {
      return (i.weapon === 'gun' || i.weapon === 'cannon') && typeof i.down === 'boolean' && finite(i.at) ? 'discrete' : null
    }
    return null
  },
  apply: (world, playerId, input: TankInput) => applyTankInput(world, playerId, input),
  step: stepTank,
  afterFrame(world) {
    world.coverChanged = []
    world.blasts = []
    if (world.tick >= world.nextFullCoverTick) world.nextFullCoverTick = world.tick + FULL_COVER_EVERY_TICKS
  },
  tick: (world) => world.tick,
  boardFrame: (world) => ({
    field: TANK_FIELD,
    ...(world.tick >= world.nextFullCoverTick ? { cover: encodeCover(world.cover) } : {}),
    coverChanged: [...world.coverChanged],
    tanks: world.tanks.map((tank) => projectTank(world, tank)),
    projectiles: world.projectiles.map((shot) => ({ id: shot.id, weapon: shot.weapon, position: { ...shot.position } })),
    blasts: world.blasts.map((blast) => ({ ...blast, position: { ...blast.position } })),
  }),
  playerFrame(world, playerId, clock) {
    const mine = tankOf(world, playerId)
    if (!mine) return null
    return {
      crew: mine.crew,
      tank: {
        ...projectTank(world, mine),
        respawnAt: mine.deadUntilMs === null ? null : clock(mine.deadUntilMs),
        gun: projectWeapon(world, mine, 'gun', clock),
        cannon: projectWeapon(world, mine, 'cannon', clock),
      },
    }
  },
  results: tankResults,
}
