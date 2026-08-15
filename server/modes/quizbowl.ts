/**
 * Quizbowl-lite: powers, negs, bouncebacks, and item drops.
 *
 * Power is a signal, not a timer. A reader (`npm run read`) fires the
 * host-scoped `powerEnds` act when it finishes speaking the power fragment;
 * a buzz whose clamped press time beats that stamp is powered. Press times
 * are already clamped to [armedAt, arrivedAt], so no phone can backdate into
 * the window. Until any reader fires, power stays open the whole question —
 * graceful degradation to "everything is a power", visible on the host.
 */
import type { GameModule } from '../../shared/modes/types.ts'
import type { State } from '../../shared/protocol.ts'
import { bump, scoreKey } from '../state.ts'
import { randomItemId } from '../items.ts'

type QuizbowlState = { powerEndsAt?: number }

const ms = (state: State) => state.game.moduleState as QuizbowlState

export const quizbowl: GameModule = {
  id: 'quizbowl',
  name: 'Quizbowl-lite',
  options: [
    {
      kind: 'int',
      key: 'powerAfterFragment',
      label: 'Power ends after fragment (0 = powers off)',
      default: 2,
      min: 0,
      max: 9,
    },
    { kind: 'int', key: 'powerBonus', label: 'Power bonus', default: 50, min: 0, max: 500 },
    { kind: 'int', key: 'neg', label: 'Wrong-answer penalty', default: 0, min: 0, max: 500 },
    {
      kind: 'bool',
      key: 'bouncebacks',
      label: 'Bouncebacks (wrong answerers sit out the rebound)',
      default: true,
    },
    { kind: 'bool', key: 'itemsEnabled', label: 'Item drops', default: false },
  ],

  init: () => ({}),

  // The power cutoff belongs to the question, not the arm: a `wrong` rebound
  // re-arms but keeps it, so rebound buzzes are correctly unpowered.
  onArm: (state) => {
    ms(state).powerEndsAt = undefined
  },

  onAct(state, act) {
    if (act !== 'powerEnds') return false
    ms(state).powerEndsAt = Date.now()
    return true
  },

  onCorrect(state) {
    const leader = state.round.order[0]
    if (!leader) return
    const cutoff = ms(state).powerEndsAt
    const powered =
      Number(state.game.options.powerAfterFragment ?? 0) > 0 &&
      (cutoff === undefined || leader.at < cutoff)
    const points =
      state.round.value + (powered ? Number(state.game.options.powerBonus ?? 0) : 0)
    bump(state, scoreKey(state, leader.playerId), points)
    state.round.award = { name: leader.name, points }
  },

  onWrong(state, neg) {
    const leader = state.round.order[0]
    if (!leader) return
    const key = scoreKey(state, leader.playerId)
    // The host's "no penalty" button sends 0 and always means it; otherwise
    // the module's configured neg wins over whatever the button said.
    state.scores[key] ??= 0
    const penalty = neg === 0 ? 0 : Number(state.game.options.neg ?? 0)
    if (penalty) bump(state, key, -penalty)
    if (state.game.options.bouncebacks !== false) {
      if (!state.round.lockedOut.includes(key)) state.round.lockedOut.push(key)
    }
  },

  grants(state) {
    if (state.game.options.itemsEnabled !== true) return []
    const leader = state.round.order[0]
    if (!leader) return []
    return [{ playerId: leader.playerId, itemId: randomItemId() }]
  },

  // No viewModuleState: the framework default shows host/board the raw blob
  // (the host's power chip reads it) and hides it from phones.
}
