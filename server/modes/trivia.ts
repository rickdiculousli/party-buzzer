import type { GameModule } from '../../shared/modes/types.ts'

/**
 * Today's game, as a module: no hooks, no options, no module state. Every
 * framework default exists so that this module can be empty — current
 * behavior is the default, not a special case.
 */
export const trivia: GameModule = {
  id: 'trivia',
  name: 'Trivia',
  options: [],
  init: () => ({}),
}
