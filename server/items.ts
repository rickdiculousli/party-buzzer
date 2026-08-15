/**
 * Boons and sabotage. Framework-level so items compose with any mode: modes
 * never learn items exist, and items never learn which mode dealt them.
 * Firing rides the `act` channel (`useItem`); validation failure consumes
 * nothing and is silent to the room.
 *
 * The display names are mirrored in client/Player.tsx's ITEM_INFO — the wire
 * carries only ids, and three items do not justify a catalog channel.
 */
import type { ActiveEffect, PlayerId, State } from '../shared/protocol.ts'
import type { ItemDef, ItemGrant } from '../shared/modes/types.ts'
import { buzzBlockReason, scoreKey } from './state.ts'

export const ITEMS: ItemDef[] = [
  {
    id: 'freeze',
    name: 'Freeze',
    target: 'opponent',
    // Fires between questions and lands on the next arm. During ARMED the
    // thumbs are already down — a freeze then would be a race, not a boon.
    usableWhen: (state) => state.round.phase === 'IDLE',
    apply(state, _userId, targetId) {
      const held = state.items[targetId!]
      const shield = held?.indexOf('shield') ?? -1
      if (held && shield >= 0) {
        // The shield is passive: it eats the freeze and is spent.
        held.splice(shield, 1)
        if (held.length === 0) delete state.items[targetId!]
        return
      }
      const effect: ActiveEffect = { kind: 'frozen', playerId: targetId! }
      state.effects.push(effect)
    },
  },
  {
    id: 'shield',
    name: 'Shield',
    target: 'self',
    // Never fired by hand; freeze's apply finds it in the target's inventory.
    usableWhen: () => false,
    apply() {},
  },
  {
    id: 'steal',
    name: 'Steal',
    target: 'self',
    usableWhen: (state, userId) => {
      const round = state.round
      if (round.phase !== 'ARMED' && round.phase !== 'COLLECTING') return false
      if (round.lockedOut.length === 0) return false // rebounds only
      // trivia defines no canBuzz, so buzzBlockReason never consults
      // lockedOut — the thief checks the lockout list for themselves.
      if (round.lockedOut.includes(scoreKey(state, userId))) return false
      if (round.order.some((b) => b.playerId === userId)) return false
      if (
        state.effects.some(
          (e) => e.kind === 'steal' && e.roundArmedAt === round.armedAt,
        )
      )
        return false
      return buzzBlockReason(state, userId) === null
    },
    // An effect, not an order mutation: round.order is republished from the
    // raw buzzes on every packet, so anything written there directly is
    // clobbered. The hub's publish prepends the thief.
    apply: (state, userId) => {
      state.effects.push({
        kind: 'steal',
        playerId: userId,
        roundArmedAt: state.round.armedAt,
      })
    },
  },
]

export function randomItemId(): string {
  return ITEMS[Math.floor(Math.random() * ITEMS.length)].id
}

/**
 * Fire an item from a player's `act` message. Validates inventory,
 * `usableWhen`, and target before `apply` runs; returns false and consumes
 * nothing on any failure.
 */
export function useItem(state: State, userId: PlayerId, data: unknown): boolean {
  const { itemId, targetId } = (data ?? {}) as Record<string, unknown>
  const def = ITEMS.find((i) => i.id === itemId)
  if (!def) return false
  const held = state.items[userId]
  const at = held?.indexOf(def.id) ?? -1
  if (!held || at < 0) return false
  if (!def.usableWhen(state, userId)) return false
  if (def.target === 'opponent') {
    if (typeof targetId !== 'string') return false
    if (targetId === userId) return false
    if (!state.players.some((p) => p.id === targetId)) return false
  }
  def.apply(state, userId, targetId as string | undefined)
  held.splice(at, 1)
  if (held.length === 0) delete state.items[userId]
  return true
}

/** Modules declare drops; the framework executes them. */
export function executeGrants(state: State, grants: ItemGrant[]): void {
  for (const g of grants) {
    if (!ITEMS.some((i) => i.id === g.itemId)) continue
    if (!state.players.some((p) => p.id === g.playerId)) continue
    ;(state.items[g.playerId] ??= []).push(g.itemId)
  }
}
