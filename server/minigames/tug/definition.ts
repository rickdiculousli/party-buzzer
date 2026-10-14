import type { MinigameDefinition, Clock } from '../definition.ts'
import { createTugWorld, pull, stepTug, TUG_STEP_MS, tugFinished, tugPresence, tugResults, type TugWorld } from './world.ts'

const shared = (world: TugWorld, clock: Clock) => ({
  sides: world.sides.map((side) => ({ ...side, members: [...side.members] })),
  flag: world.flag,
  effort: [...world.effort],
  endsAt: clock(world.durationMs),
  ...(world.endedAtMs !== undefined ? { winner: world.winner ?? null } : {}),
})

/** Tug of war: two sides tap to drag the flag past their mark, or are ahead when the rope stops. */
export const tug: MinigameDefinition<TugWorld> = {
  stepMs: TUG_STEP_MS,
  create: (_seed, participants, options, _lobby, room = { grouping: 'solo', players: [], teams: [], scores: {} }) => ({
    world: createTugWorld({ participants, room, durationSec: options.durationSec, value: options.value }),
  }),
  startable: (_lobby, connected) => connected.length < 2 ? 'too-few-players' : null,
  // Taps are a flood, not commands: no ack, applied in arrival order each step.
  classify: (input) => (input as { kind?: unknown } | null)?.kind === 'pull' ? 'continuous' : null,
  apply(world, playerId) {
    pull(world, playerId)
    return { status: 'accepted' }
  },
  step: stepTug,
  finished: tugFinished,
  presence: tugPresence,
  tick: (world) => world.tick,
  boardFrame: shared,
  playerFrame(world, playerId, clock) {
    const puller = world.pullers[playerId]
    if (!puller) return null
    return { ...shared(world, clock), side: puller.side, pull: Math.round(puller.pull) }
  },
  results: tugResults,
}
