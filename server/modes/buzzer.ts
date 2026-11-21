import type { GameModule } from '../../shared/modes/types.ts'

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
