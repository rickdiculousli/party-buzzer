import { isMinigameId, type PlayerId, type SetlistBlock, type State } from './protocol.ts'

export const PRACTICE_PULSE_MS = 600

export type IntroductionCopy = { title: string; goal: string; phone: string }

export type ArrivalPresentation =
  | { kind: 'lobby' }
  | ({
    kind: 'introduction'
    detail?: string
    next: boolean
  } & IntroductionCopy)

export const NEXT_LABEL = 'Next:'

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
    phone: 'Your controls and crew appear when the match opens.',
  },
  ink: {
    title: 'Phantom Ink',
    goal: 'Help your team find the secret word',
    phone: 'Choose a team when the match opens.',
  },
  buzzer: {
    title: 'Pure buzzer',
    goal: 'Buzz first to answer',
    phone: 'Buzz when you know it.',
  },
  sketch: {
    title: 'Sketch',
    goal: 'Draw the word, or guess it fast',
    phone: 'Draw when it is your turn; otherwise type guesses.',
  },
  tug: {
    title: 'Tug of war',
    goal: 'Drag the flag past your mark',
    phone: 'Tap to pull when the match starts.',
  },
  poker: {
    title: 'Poker',
    goal: 'Win every stack at the table',
    phone: 'Your cards and bets appear when the host starts the match.',
  },
}

export function practiceAllowed(state: State, playerId: PlayerId, lobbyId: string): boolean {
  const a = state.arrival
  if (a?.kind !== 'lobby' || a.id !== lobbyId) return false
  if (state.readingActive || state.minigame) return false
  return state.players.some((p) => p.id === playerId && p.connected)
}

export function arrivalBlocksPlay(state: State): boolean {
  return state.arrival?.kind === 'introduction'
}

export function endLobby(state: State): void {
  if (state.arrival?.kind === 'lobby') delete state.arrival
}

export function introductionFor(gameId: string): IntroductionCopy {
  return Object.hasOwn(INTRODUCTIONS, gameId)
    ? INTRODUCTIONS[gameId]
    : { title: gameId, goal: 'The host will explain this game', phone: 'Wait for the host to begin' }
}

export function autoPrepares(state: State, block: SetlistBlock): boolean {
  return state.autoplay.on && isMinigameId(block.game) && block.game !== 'poker'
}

function blockDetail(state: State, block: SetlistBlock): string | undefined {
  if (isMinigameId(block.game)) return autoPrepares(state, block) ? 'Tap Ready when the match opens' : undefined
  const parts = [`${block.count} ${block.count === 1 ? 'question' : 'questions'}`]
  if (block.value !== undefined) parts.push(`${block.value} points`)
  if (block.duel) parts.push(`Duels: ${state.duelRules.find((rule) => rule.id === block.duel)?.name ?? block.duel}`)
  return parts.join(' · ')
}

export function introductionLine(p: Extract<ArrivalPresentation, { kind: 'introduction' }>): string {
  const stop = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)
  return [...(p.next ? [NEXT_LABEL] : []), `${p.title}.`, stop(p.goal), ...(p.detail ? [stop(p.detail)] : [])].join(' ')
}

export function arrivalPresentation(state: State): ArrivalPresentation | null {
  const a = state.arrival
  if (!a) return null
  if (a.kind === 'lobby') return { kind: 'lobby' }
  const block = state.setlist?.blocks[a.blockAt]
  const detail = block && blockDetail(state, block)
  return {
    kind: 'introduction',
    ...introductionFor(block?.game ?? state.game.id),
    ...(detail && { detail }),
    next: a.blockAt > 0,
  }
}
