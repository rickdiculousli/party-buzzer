import type { Card, PlayerId } from '../../../shared/protocol.ts'
import { DECK } from './cards.ts'
import { best, compare } from './evaluate.ts'

export const EVALUATIONS = 10_000

export function equity(hands: Record<PlayerId, [Card, Card]>, board: Card[], rand: () => number, evaluations = EVALUATIONS): Record<PlayerId, number> {
  const ids = Object.keys(hands)
  const known = new Set([...board, ...ids.flatMap((id) => hands[id])])
  const left = DECK.filter((card) => !known.has(card))
  const need = 5 - board.length
  const share: Record<PlayerId, number> = Object.fromEntries(ids.map((id) => [id, 0]))
  let runs = 0
  const run = (extra: Card[]) => {
    const full = [...board, ...extra]
    let top: number[] | null = null
    let winners: PlayerId[] = []
    for (const id of ids) {
      const score = best([...hands[id], ...full]).score
      const diff = top ? compare(score, top) : 1
      if (diff > 0) { top = score; winners = [id] } else if (diff === 0) winners.push(id)
    }
    for (const id of winners) share[id] += 1 / winners.length
    runs++
  }
  if (board.length >= 3) {
    const pick = (from: number, extra: Card[]): void => {
      if (extra.length === need) return run(extra)
      for (let i = from; i < left.length; i++) pick(i + 1, [...extra, left[i]])
    }
    pick(0, [])
  } else {
    const pool = [...left]
    const samples = Math.round(evaluations / ids.length)
    for (let n = 0; n < samples; n++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rand() * (pool.length - i))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      run(pool.slice(0, need))
    }
  }
  return Object.fromEntries(ids.map((id) => [id, share[id] / runs]))
}
