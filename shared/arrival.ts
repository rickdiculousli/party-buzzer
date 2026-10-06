/**
 * The arrival: a practice lobby and a first-block introduction.
 *
 * Small pure helpers over `State.arrival`, shared by the server and every
 * surface. The copy registry is descriptive data, not rules: it names a game
 * and says what to expect, and nothing reads it to decide eligibility.
 */
import type { PlayerId, State } from './protocol.ts'

/** How long a practice press lights its player, measured locally from receipt. */
export const PRACTICE_PULSE_MS = 600

export type IntroductionCopy = { title: string; goal: string; phone: string }

/** The public arrival occupant: the same facts on the board and every phone. */
export type ArrivalPresentation = { kind: 'lobby' } | ({ kind: 'introduction' } & IntroductionCopy)

const INTRODUCTIONS: Record<string, IntroductionCopy> = {
  trivia: {
    title: 'Trivia',
    goal: 'Answer questions to earn points',
    phone: 'Buzz to answer. If choices appear, pick one.',
  },
  quizbowl: {
    title: 'Quizbowl-lite',
    goal: 'Buzz when you know the answer',
    phone: 'Listen to the clues, then buzz to answer.',
  },
  bow: {
    title: 'Bow',
    goal: 'Hit targets to earn points',
    phone: 'Drag down and release when the match starts.',
  },
  tank: {
    title: 'Tank battle',
    goal: 'Work with your crew to earn points',
    phone: 'Your controls and crew appear when the host opens the match.',
  },
  ink: {
    title: 'Phantom Ink',
    goal: 'Help your team find the secret word',
    phone: 'Choose a team when the host opens the game.',
  },
}

/** Correct lobby, connected roster member, and nothing else running. */
export function practiceAllowed(state: State, playerId: PlayerId, lobbyId: string): boolean {
  const a = state.arrival
  if (a?.kind !== 'lobby' || a.id !== lobbyId) return false
  if (state.readingActive || state.minigame) return false
  return state.players.some((p) => p.id === playerId && p.connected)
}

/** An introduction holds play until the host continues. A lobby never refuses play: play ends it. */
export function arrivalBlocksPlay(state: State): boolean {
  return state.arrival?.kind === 'introduction'
}

export function introductionFor(gameId: string): IntroductionCopy {
  return Object.hasOwn(INTRODUCTIONS, gameId)
    ? INTRODUCTIONS[gameId]
    : { title: gameId, goal: 'The host will explain this game', phone: 'Wait for the host to begin' }
}

/**
 * What covers the room, from facts every role receives: the arrival and the
 * setlist's block names. Never round content, picks, or reader progress, so a
 * redacted phone gets the same answer as the board.
 */
export function arrivalPresentation(state: State): ArrivalPresentation | null {
  const a = state.arrival
  if (!a) return null
  if (a.kind === 'lobby') return { kind: 'lobby' }
  const game = state.setlist?.blocks[a.blockAt]?.game ?? state.game.id
  return { kind: 'introduction', ...introductionFor(game) }
}
