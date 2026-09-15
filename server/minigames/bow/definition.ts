import type { BowInput } from '../../../shared/protocol.ts'
import { numberOption, type Clock, type MinigameDefinition } from '../definition.ts'
import { BOW_FIELD, BOW_STEP_MS, type BowPlayer, type BowWorld } from './types.ts'
import { bowResults, createBowWorld, releaseBow, sampleBowTrajectory, setBowAim, stepBow } from './world.ts'

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

const projectPlayer = (player: BowPlayer, clock: Clock) => ({
  id: player.id, origin: { ...player.origin }, aim: { ...player.aim }, score: player.score,
  reloadUntilMs: clock(player.reloadUntilMs),
})

export const bow: MinigameDefinition<BowWorld> = {
  stepMs: BOW_STEP_MS,
  options: (raw) => ({ reloadMs: numberOption(raw.reloadMs, 100, 0, 5_000) }),
  create: (seed, participants, options) => ({
    world: createBowWorld({ seed, playerIds: participants, config: { reloadMs: options.reloadMs } }),
  }),
  classify(input) {
    const i = input as { kind?: unknown; angle?: unknown; tension?: unknown; at?: unknown } | null
    if (i?.kind === 'aim') return finite(i.angle) && finite(i.tension) ? 'continuous' : null
    if (i?.kind === 'release') return finite(i.at) ? 'discrete' : null
    return null
  },
  apply(world, playerId, input: BowInput) {
    if (input.kind === 'aim') {
      setBowAim(world, playerId, { angle: input.angle, tension: input.tension })
      return { status: 'accepted' }
    }
    const result = releaseBow(world, playerId)
    if (result.status === 'accepted') return { status: 'accepted' }
    return { status: 'refused', reason: result.reason === 'unknown-player' ? 'not-participant' : result.reason }
  },
  step: stepBow,
  tick: (world) => world.tick,
  boardFrame: (world, clock) => ({
    field: BOW_FIELD,
    targets: world.targets.map((target) => ({ ...target, center: { ...target.center } })),
    players: Object.values(world.players).map((player) => projectPlayer(player, clock)),
    arrows: world.arrows.map((arrow) => ({
      id: arrow.id, playerId: arrow.playerId, position: { ...arrow.position }, angle: arrow.angle,
      state: arrow.state, tailKick: arrow.tailKick,
    })),
  }),
  playerFrame(world, playerId, clock) {
    if (!Object.hasOwn(world.players, playerId)) return null
    return { player: projectPlayer(world.players[playerId], clock), trajectory: sampleBowTrajectory(world, playerId, 18) }
  },
  results: bowResults,
}
