/**
 * The game flow: an ordered setlist of blocks, walked one question at a time.
 *
 * It advises rather than plays. Entering a block applies its setup — the mode,
 * its options, the round value, a duel if the block wants one — and stops. The
 * host still arms, judges and moves on, which is what keeps the reader's loop
 * the only thing in the room that issues `arm`.
 *
 * Pure, like duel.ts: the applier arrives as a parameter rather than importing
 * applyHostAction, which would be a cycle. That also makes every rule here
 * testable against a recording fake.
 */
import type { FlowBlock, HostAction, State } from '../shared/protocol.ts'

export type Apply = (action: HostAction) => void

/**
 * The block's mode, its options and its round value. Split out from
 * `enterBlock` so `setFlow` can re-apply setup alone when the block at a kept
 * position changed shape, without also re-firing the duel half below (that
 * would blow away an in-flight nomination pool for a tweak that has nothing
 * to do with it).
 *
 * Re-stamping the value every question would fight two legitimate things: the
 * host's own mid-block tweak, and the reader's per-question `setValue` from the
 * pack. Neither should lose to a setting written an hour ago — which is why
 * this only runs when the caller says the block itself is fresh.
 */
export function applySetup(state: State, apply: Apply): void {
  const flow = state.flow
  const block = flow?.blocks[flow.at]
  if (!block) return
  apply({ a: 'setGame', id: block.game, options: block.options, keepScores: true })
  if (block.value !== undefined) apply({ a: 'setValue', value: block.value })
}

/** The block's duel, if it declares one — a duel block is a duel per question. */
export function applyDuel(state: State, apply: Apply): void {
  const flow = state.flow
  const block = flow?.blocks[flow.at]
  if (!block) return
  if (block.duel) apply({ a: 'openDuel', rule: block.duel })
}

/**
 * Set up the block the flow is on. `fresh` means the block itself changed, so
 * the mode and the value are re-applied; a duel opens either way, because a
 * duel block is a duel per question.
 */
export function enterBlock(state: State, apply: Apply, fresh: boolean): void {
  if (fresh) applySetup(state, apply)
  applyDuel(state, apply)
}

/**
 * One question has gone by. Spends it against the current block and rolls over
 * when the count runs out. A spent flow sits at its end rather than wrapping —
 * the host reads the position off the board and decides whether to jump back.
 */
export function advanceFlow(state: State, apply: Apply): void {
  const flow = state.flow
  if (!flow || !flow.blocks[flow.at]) return
  flow.done += 1
  let fresh = false
  if (flow.done >= flow.blocks[flow.at].count) {
    flow.at += 1
    flow.done = 0
    fresh = true
  }
  enterBlock(state, apply, fresh)
}

/**
 * Coerce untrusted blocks — a host message, a file written by another build —
 * into ones this build can actually run. A block naming a module or a duel rule
 * that is not registered here is dropped rather than failing the whole setlist,
 * the way a bad pack question is.
 */
export function sanitizeBlocks(
  raw: unknown,
  knownGame: (id: string) => boolean,
  knownRule: (id: string) => boolean,
): FlowBlock[] {
  if (!Array.isArray(raw)) return []
  const out: FlowBlock[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const b = entry as Partial<FlowBlock>
    if (typeof b.game !== 'string' || !knownGame(b.game)) {
      console.warn(`[flow] block names unknown game "${String(b.game)}" — dropped`)
      continue
    }
    if (b.duel !== undefined && (typeof b.duel !== 'string' || !knownRule(b.duel))) {
      console.warn(`[flow] block names unknown duel rule "${String(b.duel)}" — dropped`)
      continue
    }
    // ponytail: options ride through unchecked. setGame sanitizes them against
    // the module's schema on the way in, which is the only place that knows it.
    const count = Number(b.count)
    const block: FlowBlock = {
      game: b.game,
      options: typeof b.options === 'object' && b.options !== null ? b.options : {},
      count: Math.min(99, Math.max(1, Number.isFinite(count) ? Math.round(count) : 1)),
    }
    // The pack is only a filename here; the reader is what discovers it does
    // not exist, and says so the same way a hand-typed selectPack would.
    if (typeof b.pack === 'string' && b.pack) block.pack = b.pack
    if (typeof b.value === 'number' && Number.isFinite(b.value)) block.value = b.value
    if (b.duel) block.duel = b.duel
    out.push(block)
  }
  return out
}
