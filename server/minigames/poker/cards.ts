import type { Card } from '../../../shared/protocol.ts'
import { mulberry32 } from '../../../shared/random.ts'
import { shuffle } from '../shuffle.ts'

export const RANKS = '23456789TJQKA'
export const SUITS = 'shdc'

export const DECK: Card[] = [...RANKS].flatMap((rank) => [...SUITS].map((suit) => rank + suit))

/** 0 for a two up to 12 for an ace. */
export const rankOf = (card: Card) => RANKS.indexOf(card[0])

/** Each hand's deck follows from the seed and the hand number, so no shuffle state needs saving. */
export function handDeck(seed: number, hand: number): Card[] {
  return shuffle(mulberry32((seed ^ Math.imul(hand, 0x9e3779b1)) >>> 0), DECK)
}
