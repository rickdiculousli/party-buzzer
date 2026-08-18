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
  /** The only players who may buzz this round. Set by a duel; absent = open. */
  candidates?: PlayerId[]
  /**
   * Set when a question has been scored, and cleared when the next one starts.
   * The board keeps the result up for as long as this is here — the payoff
   * needs to outlive the button press that caused it.
   */
  award?: { name: string; points: number }
  /**
   * The judge's offer to the locked-in leader. Present means push-to-talk is
   * live; `until` is the server-domain deadline, absent means the host ends a
   * stall by hand. Swept with the next arm; ended by any verdict.
   */
  judge?: { until?: number }
  /**
   * What the locked-in player said and how it scored. Kept through a rebound —
   * the room heard it — and cleared on the next arm.
   */
  spoken?: { name: string; transcript: string; hit: boolean }
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

/** A nomination pool entry. `votes` holds voter ids, not a count — one vote per player falls out of the shape. */
export type DuelPoolEntry = {
  playerId: PlayerId
  votes: PlayerId[]
  /** Volunteered and not backed off. */
  in: boolean
}

/** A duel being set up or played. Rides State, so snapshot/undo/broadcast come free. */
export type DuelState = {
  /** Id into the duelRules catalog. */
  rule: string
  pool: DuelPoolEntry[]
  /** The two finalists, once the host closes the window (or an instant rule resolves). */
  seated?: [PlayerId, PlayerId]
  /** Finalists who answered wrong this question — drives the exclusive rebound. */
  missed: PlayerId[]
}

/** One selection rule, declared as data so the host rule picker needs no per-rule code. */
export type DuelRuleInfo = {
  id: string
  name: string
  /** How players enter the pool; 'none' = host-pick / random. */
  entry: 'vote' | 'volunteer' | 'both' | 'none'
  /** How the pool narrows to two; 'host' = the host seats explicitly. */
  resolve: 'votes' | 'random' | 'host'
}

/**
 * A live item effect. Stamped with the arm it belongs to when the question
 * opens; swept on the next arm, so nothing leaks across questions.
 */
export type ActiveEffect = {
  kind: 'frozen' | 'steal'
  playerId: PlayerId
  roundArmedAt?: number
}

/** One stretch of the night: N questions of one mode, optionally as duels. */
export type FlowBlock = {
  /** Module id, into the same catalog the host settings form renders from. */
  game: string
  /** Values for that module's option schema; sanitized when applied. */
  options: Record<string, unknown>
  /** Questions in this block. */
  count: number
  /** Round value for the block. Absent = leave whatever the host set. */
  value?: number
  /** Duel rule id, opened before every question in the block. */
  duel?: string
}

/**
 * The setlist and where the room is in it. Rides State, so snapshot, undo and
 * broadcast come free — the same bargain `duel` and `items` take.
 */
export type FlowState = {
  blocks: FlowBlock[]
  /** Index of the running block. Equals blocks.length when the flow is spent. */
  at: number
  /** Questions gone by inside the current block. */
  done: number
}

/**
 * What the reader is doing, for the host screen alone. Display-only: the reader
 * owns playback and republishes from its own loop, so an undo that restores a
 * stale block corrects itself on the next push rather than rewinding the audio.
 */
export type ReadingState = {
  pack: string
  qIndex: number
  qTotal: number
  fragIndex: number
  fragTotal: number
  paused: boolean
  /** Whether the read loop is actually driving the round, vs. selected-but-idle. */
  running: boolean
  /** Present only while a freshly selected pack is being synthesised. */
  rendering?: { done: number; total: number }
}

/**
 * Autoplay: the two beats a human host provides by instinct and the reader
 * otherwise waits on forever. `on` only removes keypresses — the host still
 * judges, unless the spoken-answer judge is doing that too.
 */
export type Autoplay = {
  on: boolean
  /** Seconds the answer sits on the wall before the next question is armed. */
  nextSec: number
  /** Seconds of silence after a wrong answer before the clue picks back up. */
  reboundSec: number
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
  /** A duel in setup or play. Absent = today's game. */
  duel?: DuelState
  /** Static rule catalog. Refreshed at startup beside `games`. */
  duelRules: DuelRuleInfo[]
  /** The setlist, if the host built one. Absent = the host is driving freehand. */
  flow?: FlowState
  /** Saved flow filenames on disk. Filenames only, like `packs`. */
  flows: string[]
  /** Pack filenames on disk. Filenames only — question content never enters State. */
  packs: string[]
  /** Whether players see round.fragments. Off for quizbowl: reading a whole
   *  sentence at its start beats hearing it word by word. */
  mirrorFragments: boolean
  /** Seconds a locked-in player has to speak before silence scores wrong. 0 = no timeout. */
  answerWindowSec: number
  /** Hands-off reading: the reader supplies its own N and paces the beats. */
  autoplay: Autoplay
  reading?: ReadingState
}

export type HostAction =
  | { a: 'arm' }
  | { a: 'correct' }
  | { a: 'wrong'; neg: number }
  | { a: 'next' }
  | { a: 'resetRound' }
  | { a: 'undo' }
  | { a: 'setValue'; value: number }
  | { a: 'setAnswerWindow'; sec: number }
  | { a: 'setScore'; key: ScoreKey; score: number }
  | { a: 'rename'; playerId: PlayerId; name: string }
  | { a: 'kick'; playerId: PlayerId }
  | { a: 'setMode'; mode: Mode }
  | { a: 'addTeam'; name: string; color: string }
  | { a: 'assign'; playerId: PlayerId; teamId?: TeamId }
  /** `keepScores` is the flow crossing a block boundary; a host switch resets. */
  | { a: 'setGame'; id: string; options: Record<string, unknown>; keepScores?: boolean }
  | { a: 'setMirror'; on: boolean }
  /** The whole triple every time: one edit, one undo step, no partial merge. */
  | { a: 'setAutoplay'; on: boolean; nextSec: number; reboundSec: number }
  | { a: 'openDuel'; rule: string }
  /** ids = host override (and the only path for resolve:'host' rules); absent = resolve by rule. */
  | { a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }
  | { a: 'cancelDuel' }
  /** The builder writes the whole array: one edit, one undo step. Empty clears. */
  | { a: 'setFlow'; blocks: FlowBlock[] }
  | { a: 'flowJump'; at: number }
  | { a: 'clearFlow' }

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
