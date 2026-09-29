import type { PlayerId } from '../../../shared/protocol.ts'
import { compare } from './evaluate.ts'

export type Pot = { amount: number; eligible: PlayerId[] }

/**
 * Slices the chips at each all-in level, main pot first. Folded chips count
 * toward the amount; a layer only one player reached is their uncalled bet
 * coming back.
 */
export function buildPots(contributed: Record<PlayerId, number>, folded: PlayerId[]): Pot[] {
  const players = Object.keys(contributed)
  const levels = [...new Set(players.filter((id) => !folded.includes(id)).map((id) => contributed[id]))]
    .filter((level) => level > 0)
    .sort((a, b) => a - b)
  const pots: Pot[] = []
  let floor = 0
  for (const level of levels) {
    const amount = players.reduce((sum, id) => sum + Math.max(0, Math.min(contributed[id], level) - floor), 0)
    const eligible = players.filter((id) => !folded.includes(id) && contributed[id] >= level)
    if (amount > 0) pots.push({ amount, eligible })
    floor = level
  }
  // Chips folded above every live level (a folder who outbet everyone left) join the last pot.
  const rest = players.reduce((sum, id) => sum + Math.max(0, contributed[id] - floor), 0)
  if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest
  return pots
}

/** Splits each pot among its best hands; odd chips go to the first winner left of the button. */
export function awardPots(pots: Pot[], scores: Record<PlayerId, number[]>, leftOfButton: PlayerId[]): Record<PlayerId, number> {
  const won: Record<PlayerId, number> = {}
  for (const pot of pots) {
    let winners: PlayerId[] = []
    for (const id of pot.eligible) {
      const diff = winners.length ? compare(scores[id], scores[winners[0]]) : 1
      if (diff > 0) winners = [id]
      else if (diff === 0) winners.push(id)
    }
    winners.sort((a, b) => leftOfButton.indexOf(a) - leftOfButton.indexOf(b))
    const share = Math.floor(pot.amount / winners.length)
    let odd = pot.amount - share * winners.length
    for (const id of winners) {
      won[id] = (won[id] ?? 0) + share + (odd > 0 ? 1 : 0)
      odd--
    }
  }
  return won
}
