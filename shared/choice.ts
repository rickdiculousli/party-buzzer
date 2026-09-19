/**
 * Multiple-choice questions: who may pick, and what the voice reads after the
 * question. Shared so the board's "6 of 9 in" and the reader's "everyone has
 * picked" count the same players.
 */
import type { PlayerId, State } from './protocol.ts'

export const LETTERS = 'ABCDEF'

/** Connected, seated if a duel set a pair, and not frozen for this attempt. */
export function pickers(state: State): PlayerId[] {
  const r = state.round
  return state.players
    .filter((p) => p.connected)
    .filter((p) => !r.buzzable || r.buzzable.includes(p.id))
    .filter((p) => !state.effects.some((e) => e.kind === 'frozen' && e.playerId === p.id && e.attemptId === r.attemptId))
    .map((p) => p.id)
}

/** False with nobody eligible, so an empty room waits for the timer. */
export function allPicked(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.picks?.[id] !== undefined)
}

/** "A, Mars. B, Venus." */
export function optionsText(choices: string[]): string {
  return choices.map((c, i) => `${LETTERS[i]}, ${c}.`).join(' ')
}
