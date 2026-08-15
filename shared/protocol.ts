export type PlayerId = string
export type TeamId = string
/** Scores key on team id in teams mode, player id in solo mode. */
export type ScoreKey = string

export type Role = 'player' | 'host' | 'board'
export type Mode = 'solo' | 'teams'
export type Phase = 'IDLE' | 'ARMED' | 'COLLECTING' | 'LOCKED'

export type Player = {
  id: PlayerId
  name: string
  teamId?: TeamId
  connected: boolean
}

export type Team = {
  id: TeamId
  name: string
  color: string
}

/** One resolved buzz. `at` is server-domain ms; `deltaMs` is ms behind first place. */
export type BuzzEntry = {
  playerId: PlayerId
  name: string
  at: number
  deltaMs: number
}

export type Round = {
  value: number
  phase: Phase
  armedAt: number
  /** Full list for host/board. Redacted to the recipient's own entry for players. */
  order: BuzzEntry[]
  /** How many buzzed in total, so a redacted player still sees "2 of 5". */
  total: number
  /** Score keys barred from this round after a wrong answer. */
  lockedOut: ScoreKey[]
}

export type State = {
  mode: Mode
  players: Player[]
  teams: Team[]
  scores: Record<ScoreKey, number>
  round: Round
}

export type HostAction =
  | { a: 'arm' }
  | { a: 'correct' }
  | { a: 'wrong'; neg: number }
  | { a: 'next' }
  | { a: 'resetRound' }
  | { a: 'setValue'; value: number }
  | { a: 'setScore'; key: ScoreKey; score: number }
  | { a: 'rename'; playerId: PlayerId; name: string }
  | { a: 'kick'; playerId: PlayerId }
  | { a: 'setMode'; mode: Mode }
  | { a: 'addTeam'; name: string; color: string }
  | { a: 'assign'; playerId: PlayerId; teamId?: TeamId }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; serverTime: number }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'state'; state: State }
