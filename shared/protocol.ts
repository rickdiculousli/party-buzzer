export type PlayerId = string
export type TeamId = string
/** Scores key on team id in teams mode, player id in solo mode. */
export type ScoreKey = string

/**
 * Arming is scheduled this far ahead instead of taking effect on arrival, so
 * every surface opens at the same real instant however late its packet lands.
 * Long enough to cover LAN jitter, short enough that the host never waits.
 * Part of the wire contract: clients count down to `round.armedAt` and use this
 * as the ceiling on how long that countdown can possibly be.
 */
export const ARM_LEAD_MS = 300

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

/**
 * How long buzzes keep being recorded after the contest is already decided.
 * The competitive window is short on purpose, but shutting the door at 150ms
 * means most of the room never appears on the board at all. So collection runs
 * on for a second: these buzzes are shown and never scored, and their sender is
 * told plainly that they missed.
 */
export const LATE_MS = 1000

export type Round = {
  value: number
  phase: Phase
  armedAt: number
  /** Full list for host/board. Redacted to the recipient's own entry for players. */
  order: BuzzEntry[]
  /**
   * Buzzes that landed after the window shut. Shown on the board, never scored,
   * never eligible to lead. Kept apart from `order` rather than flagged inside
   * it so nothing downstream can mistake one for a contender.
   */
  late: BuzzEntry[]
  /**
   * Player views only: this phone's buzz landed after the competitive window.
   * Sent as soon as the packet arrives, so a player learns they missed straight
   * away even though the room sees nothing until collection ends.
   */
  youMissed?: boolean
  /** How many buzzed in total, so a redacted player still sees "2 of 5". */
  total: number
  /** Score keys barred from this round after a wrong answer. */
  lockedOut: ScoreKey[]
  /**
   * Set when a question has been scored, and cleared when the next one starts.
   * The board keeps the result up for as long as this is here — the payoff
   * needs to outlive the button press that caused it.
   */
  award?: { name: string; points: number }
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
  | { a: 'undo' }
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
