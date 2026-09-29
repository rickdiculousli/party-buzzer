import type { Card } from '../../../shared/protocol.ts'
import { rankOf } from './cards.ts'

/** `score` compares lexicographically: category first, then tiebreak ranks high to low. */
export type Scored = { score: number[]; category: number; name: string; five: Card[] }

const ONE = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace']
const MANY = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces']

export function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1)
    if (diff) return diff
  }
  return 0
}

/** The top rank of a straight in these five distinct ranks, or -1. The wheel's top is the five. */
function straightTop(ranks: number[]): number {
  const set = new Set(ranks)
  if (set.size !== 5) return -1
  const sorted = [...set].sort((a, b) => b - a)
  if (sorted[0] - sorted[4] === 4) return sorted[0]
  if (sorted.join() === '12,3,2,1,0') return 3
  return -1
}

function name(category: number, t: number[]): string {
  switch (category) {
    case 8: return t[0] === 12 ? 'Royal flush' : `Straight flush, ${ONE[t[0]]} high`
    case 7: return `Four of a kind, ${MANY[t[0]]}`
    case 6: return `Full house, ${MANY[t[0]]} over ${MANY[t[1]]}`
    case 5: return `Flush, ${ONE[t[0]]} high`
    case 4: return `Straight, ${ONE[t[0]]} high`
    case 3: return `Three of a kind, ${MANY[t[0]]}`
    case 2: return `Two pair, ${MANY[t[0]]} and ${MANY[t[1]]}`
    case 1: return `Pair of ${MANY[t[0]]}`
    default: return `High card, ${ONE[t[0]]}`
  }
}

function scoreFive(five: Card[]): number[] {
  const ranks = five.map(rankOf)
  const flush = new Set(five.map((card) => card[1])).size === 1
  const top = straightTop(ranks)
  // Group ranks by count, bigger groups first, then higher ranks.
  const counts = new Map<number, number>()
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1)
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const byGroup = groups.map(([rank]) => rank)
  const shape = groups.map(([, count]) => count).join('')
  if (flush && top >= 0) return [8, top]
  if (shape === '41') return [7, ...byGroup]
  if (shape === '32') return [6, ...byGroup]
  if (flush) return [5, ...byGroup]
  if (top >= 0) return [4, top]
  if (shape === '311') return [3, ...byGroup]
  if (shape === '221') return [2, ...byGroup]
  if (shape === '2111') return [1, ...byGroup]
  return [0, ...byGroup]
}

/** The best five of five to seven cards. */
export function best(cards: Card[]): Scored {
  let top: { score: number[]; five: Card[] } | null = null
  for (const five of fives(cards)) {
    const score = scoreFive(five)
    if (!top || compare(score, top.score) > 0) top = { score, five }
  }
  return { ...top!, category: top!.score[0], name: name(top!.score[0], top!.score.slice(1)) }
}

function fives(cards: Card[], from = 0, picked: Card[] = []): Card[][] {
  if (picked.length === 5) return [picked]
  const out: Card[][] = []
  for (let i = from; i <= cards.length - (5 - picked.length); i++) out.push(...fives(cards, i + 1, [...picked, cards[i]]))
  return out
}
