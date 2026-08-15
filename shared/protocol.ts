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
 * How long buzzes are collected after the first one lands, before the order
 * is published. One window, one second: inputs coalesce within it and the
 * clamped press time alone decides the order, so a slow phone carrying an
 * early stamp still wins. Nothing is revealed to the room until it closes.
 */
export const COLLECT_MS = 1000

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
  /**
   * Set when a question has been scored, and cleared when the next one starts.
   * The board keeps the result up for as long as this is here — the payoff
   * needs to outlive the button press that caused it.
   */
  award?: { name: string; points: number }
  /** Question text revealed so far, in order. Stripped from player views. */
  fragments?: string[]
  /** Revealed after scoring, if a question pack supplied one. Stripped from player views. */
  answer?: string
}

/** The active game mode. `id` names a registered module; the rest is its data. */
export type GameState = {
  id: string
  /** Values for the module's declared option schema, defaults filled. */
  options: Record<string, unknown>
  /** Opaque to the framework; the module owns and interprets it. */
  moduleState: unknown
}

/** A mode option, declared as data so the host settings form needs no per-mode code. */
export type OptionSpec =
  | { kind: 'int'; key: string; label: string; default: number; min: number; max: number }
  | { kind: 'bool'; key: string; label: string; default: boolean }
  | { kind: 'choice'; key: string; label: string; default: string; choices: string[] }

/** One registered mode, for the host's settings form. Ships in the state payload. */
export type GameInfo = { id: string; name: string; options: OptionSpec[] }

/**
 * A live item effect. Stamped with the arm it belongs to when the question
 * opens; swept on the next arm, so nothing leaks across questions.
 */
export type ActiveEffect = {
  kind: 'frozen' | 'steal'
  playerId: PlayerId
  roundArmedAt?: number
}

export type State = {
  mode: Mode
  players: Player[]
  teams: Team[]
  scores: Record<ScoreKey, number>
  round: Round
  game: GameState
  /** Item ids per player; duplicates mean a count. */
  items: Record<PlayerId, string[]>
  effects: ActiveEffect[]
  /** Static module catalog. The hub refreshes it at startup; snapshots keep a stale copy harmlessly. */
  games: GameInfo[]
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
  | { a: 'setGame'; id: string; options: Record<string, unknown> }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }
  /** Module and item actions. Dispatched by the hub; unknown acts are dropped. */
  | { t: 'act'; act: string; data?: unknown }

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; serverTime: number }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'state'; state: State }
