import { randomUUID } from 'node:crypto'
import type { SetlistBlock, HostAction, State } from '../shared/protocol.ts'
import { isMinigameId } from '../shared/protocol.ts'

export type Apply = (action: HostAction) => void

export function applySetup(state: State, apply: Apply): void {
  const setlist = state.setlist
  const block = setlist?.blocks[setlist.at]
  if (!block || isMinigameId(block.game)) return
  apply({ a: 'setMode', id: block.game, options: block.options, keepScores: true })
  if (block.value !== undefined) apply({ a: 'setValue', value: block.value })
}

export function applyDuel(state: State, apply: Apply): void {
  const setlist = state.setlist
  const block = setlist?.blocks[setlist.at]
  if (!block) return
  if (block.duel) apply({ a: 'openDuel', rule: block.duel })
}

export function enterBlock(state: State, apply: Apply, fresh: boolean, now: number): void {
  const setlist = state.setlist
  if (setlist) {
    if (setlist.at >= setlist.blocks.length) setlist.spentAt = now
    else delete setlist.spentAt
  }
  if (fresh) applySetup(state, apply)
  applyDuel(state, apply)
}

export function advanceSetlist(state: State, apply: Apply, now: number): void {
  const setlist = state.setlist
  if (!setlist || !setlist.blocks[setlist.at]) return
  setlist.done += 1
  let fresh = false
  if (setlist.done >= setlist.blocks[setlist.at].count) {
    setlist.at += 1
    setlist.done = 0
    fresh = true
  }
  enterBlock(state, apply, fresh, now)
  if (fresh) introduceBlock(state, false)
}

export function introduceBlock(state: State, force: boolean): void {
  const setlist = state.setlist
  const block = setlist?.blocks[setlist.at]
  if (!setlist || !block || !(force || state.autoplay.on)) return
  state.arrival = {
    kind: 'introduction', id: randomUUID(), blockAt: setlist.at, blockKey: `${setlist.at}:${block.game}`,
  }
}

export function sanitizeBlocks(
  raw: unknown,
  knownGame: (id: string) => boolean,
  knownRule: (id: string) => boolean,
): SetlistBlock[] {
  if (!Array.isArray(raw)) return []
  const out: SetlistBlock[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const b = entry as Partial<SetlistBlock>
    if (typeof b.game !== 'string' || !knownGame(b.game)) {
      console.warn(`[setlist] block names unknown game "${String(b.game)}" — dropped`)
      continue
    }
    if (b.duel !== undefined && (typeof b.duel !== 'string' || !knownRule(b.duel))) {
      console.warn(`[setlist] block names unknown duel rule "${String(b.duel)}" — dropped`)
      continue
    }
    const count = Number(b.count)
    const block: SetlistBlock = {
      game: b.game,
      options: typeof b.options === 'object' && b.options !== null ? b.options : {},
      count: Math.min(99, Math.max(1, Number.isFinite(count) ? Math.round(count) : 1)),
    }
    if (isMinigameId(b.game)) {
      block.count = 1
      out.push(block)
      continue
    }
    if (typeof b.pack === 'string' && b.pack) block.pack = b.pack
    if (typeof b.value === 'number' && Number.isFinite(b.value)) block.value = b.value
    if (b.duel) block.duel = b.duel
    out.push(block)
  }
  return out
}
