import type { PlayerId, State } from './protocol.ts'

export const LETTERS = 'ABCDEF'

export function pickers(state: State): PlayerId[] {
  const r = state.round
  return state.players
    .filter((p) => p.connected)
    .filter((p) => !r.buzzable || r.buzzable.includes(p.id))
    .filter((p) => !state.effects.some((e) => e.kind === 'frozen' && e.playerId === p.id && e.attemptId === r.attemptId))
    .map((p) => p.id)
}

export function allPicked(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.picks?.[id] !== undefined)
}

export function optionsText(choices: string[]): string {
  return choices.map((c, i) => `${LETTERS[i]}, ${c}.`).join(' ')
}
