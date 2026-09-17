import type { InkPoint, InkStepView, InkTeamName, MinigameTouch, State } from '../shared/protocol.ts'

export const TOUCH_MS = 600
export const FORCE_MS = 2_000
/** Pad row width over height, on the board and in the writing canvas. */
export const ROW_ASPECT = 5
export const TEAM_LABEL: Record<InkTeamName, string> = { sun: 'Sun', moon: 'Moon' }

export type TimedTouch = MinigameTouch & { at: number }

export const teamCap = (connected: number) => Math.ceil(connected / 2)

export function lobbyColumns(state: State) {
  const lobby = state.minigame?.lobby ?? { teams: {}, volunteers: [] }
  const connected = state.players.filter((player) => player.connected)
  const cap = teamCap(connected.length)
  return (['sun', 'moon'] as const).map((team) => {
    const members = connected
      .filter((player) => lobby.teams[player.id] === team)
      .map((player) => ({ id: player.id, name: player.name, volunteer: lobby.volunteers.includes(player.id) }))
    return { team, members, count: members.length, cap, over: members.length > cap }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

export function strokePath(points: InkPoint[], width: number, height: number): string {
  const [first, ...rest] = points.map(([x, y]) => `${round(x * width)} ${round(y * height)}`)
  if (!first) return ''
  return rest.length ? `M${first}L${rest.join('L')}` : `M${first}l0.01 0`
}

export function quantizePoint(x: number, y: number): InkPoint {
  const q = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000
  return [q(x), q(y)]
}

export const freshTouches = (touches: TimedTouch[], now: number) => touches.filter((touch) => now - touch.at <= TOUCH_MS)

/** The one-line status shown on the board bar and the phone header. */
export function stepLine(frame: { step: InkStepView; turn: InkTeamName }, nameOf: (id: string) => string): string {
  const team = TEAM_LABEL[frame.turn]
  const s = frame.step
  switch (s.at) {
    case 'choosing': return 'Writers are choosing the secret word'
    case 'peekPick': return `${team} is picking a clue to peek`
    case 'peekWrite': return `${TEAM_LABEL[s.team]} writer adds one letter`
    case 'choose': return `${team}: Ask or Guess?`
    case 'offer': return `${team} is choosing prompts`
    case 'keep': return `${team} writer is picking a prompt`
    case 'clue': return s.stopped ? `${team} called Stop` : `${team} writer is writing`
    case 'guess': return s.holder ? `${nameOf(s.holder)} is guessing` : `${team} is guessing`
    case 'judgeLetter': return `${team} writer is checking the letter`
    case 'judgeWord': return `${team} writer is checking the guess`
    case 'over': return s.winner ? `${TEAM_LABEL[s.winner]} wins` : 'Both teams lose'
  }
}
