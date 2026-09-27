import type { GameModule } from '../../shared/modes/types.ts'

/**
 * Just the buzzers: arm, right, wrong. Nothing is scored and nobody is locked
 * out, so a wrong reopens the same question to the whole room as many times as
 * it takes. The award is still stamped — it is how every surface knows a
 * verdict happened — but it pays nothing.
 */
export const buzzer: GameModule = {
  id: 'buzzer',
  name: 'Pure buzzer',
  scoreless: true,
  options: [],
  init: () => ({}),
  onCorrect(state) {
    const leader = state.round.order[0]
    if (leader) state.round.award = { name: leader.name, points: 0 }
  },
  onWrong(state) {
    const leader = state.round.order[0]
    if (leader) state.round.award = { name: leader.name, points: 0, penalty: true }
  },
}
