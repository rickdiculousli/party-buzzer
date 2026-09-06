/**
 * Quizbowl-lite: powers, negs, bouncebacks, and item drops.
 *
 * The reader reports completed fragments; this module owns the power boundary.
 * Buzzes before its cutoff earn a bonus. Without a reader, power remains open;
 * the existing powerEnds act also lets a host-side script close it manually.
 */
import type { GameModule, ModeContext } from '../../shared/modes/types.ts'
import { bump, scoreKey } from '../../shared/scoring.ts'

export type QuizbowlState = { powerEndsAt?: number }
export type QuizbowlOptions = {
  powerAfterFragment: number
  powerBonus: number
  neg: number
  bouncebacks: boolean
  itemsEnabled: boolean
}

function endPower(state: ModeContext<QuizbowlOptions, QuizbowlState>, at: number): boolean {
  if (state.game.moduleState.powerEndsAt !== undefined) return false
  state.game.moduleState.powerEndsAt = at
  return true
}

export const quizbowl: GameModule<QuizbowlOptions, QuizbowlState> = {
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
    state.game.moduleState.powerEndsAt = undefined
  },

  onAct(state, act) {
    if (act !== 'powerEnds') return false
    endPower(state, Date.now())
    return true
  },

  onFragmentEnd(state, completed, at) {
    const boundary = state.game.options.powerAfterFragment
    return boundary > 0 && completed >= boundary && endPower(state, at)
  },

  hostStatus(state) {
    if (state.game.options.powerAfterFragment === 0) return undefined
    return state.game.moduleState.powerEndsAt === undefined
      ? { label: 'Power open', tone: 'active' }
      : { label: 'Power ended', tone: 'inactive' }
  },

  onCorrect(state) {
    const leader = state.round.order[0]
    if (!leader) return
    const cutoff = state.game.moduleState.powerEndsAt
    const powered =
      state.game.options.powerAfterFragment > 0 &&
      (cutoff === undefined || leader.at < cutoff)
    const points =
      state.round.value + (powered ? state.game.options.powerBonus : 0)
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
    const penalty = neg === 0 ? 0 : state.game.options.neg
    if (penalty) bump(state, key, -penalty)
    // Outside the `if`: a neg of zero is still a neg, and the room has to see
    // that the question was missed even when it cost nothing.
    state.round.award = { name: leader.name, points: -penalty, penalty: true }
    if (state.game.options.bouncebacks !== false) {
      if (!state.round.lockedOut.includes(key)) state.round.lockedOut.push(key)
    }
  },

  grants(state) {
    if (state.game.options.itemsEnabled !== true) return []
    const leader = state.round.order[0]
    if (!leader) return []
    return [{ playerId: leader.playerId, random: true }]
  },

  // No viewModuleState: the default hides module memory from phones.
}
