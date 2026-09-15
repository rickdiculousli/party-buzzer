import type { Refusal } from './legality.ts'

export type PlayerId = string
export type TeamId = string
/** Scores key on team id in a teams grouping, player id in solo. */
export type ScoreKey = string

/**
 * Arming is scheduled this far ahead instead of taking effect on arrival, so
 * every surface opens at the same real instant however late its packet lands.
 * Long enough to cover LAN jitter, short enough that the host never waits.
 * Part of the wire contract: clients count down to `round.armedAt` and use this
 * as the ceiling on how long that countdown can possibly be.
 */
export const ARM_DELAY_MS = 300

export type Role = 'player' | 'host' | 'board'
export type Grouping = 'solo' | 'teams'
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

export type Award = { name: string; points: number; penalty?: true }

/**
 * Was this verdict a miss? True for every wrong answer, including the host's
 * "Wrong, no penalty" — a deduction of zero is still a deduction.
 *
 * The `points < 0` half is for an award a module stamped without the flag; the
 * flag is what makes a zero-point miss readable at all.
 */
export function isPenalty(award: Award | undefined): boolean {
  return !!award && (award.penalty === true || award.points < 0)
}

export type Round = {
  /** Stable through rebounds; empty when no question is in progress. */
  questionId: string
  /** A new identity for every arm, rebound, or restored attempt. */
  attemptId: string
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
  buzzable?: PlayerId[]
  /**
   * Set when a question has been scored, and cleared when the next one starts.
   * The board keeps the result up for as long as this is here — the payoff
   * needs to outlive the button press that caused it. A wrong answer stamps a
   * penalty, and it rides the rebound that follows.
   *
   * `penalty` is which verdict happened, not how much it cost. Carrying both on
   * the sign is wrong at exactly one value: a no-penalty wrong is a penalty of
   * zero, and reading it off `points` makes it a payoff of zero instead, so the
   * miss vanishes from the wall. `-0` does not survive the trip (`State` is
   * JSON, and `JSON.stringify(-0)` is `"0"`), so the fact is a field. Use
   * `isPenalty`, never the sign.
   */
  award?: Award
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
  /**
   * A miss is on the board and its rebound has not opened yet. Set only when
   * the reader is driving, cleared by the `rebound` that opens it.
   *
   * The phase stays `LOCKED` while this is true, which is already "nobody may
   * buzz" everywhere it matters, and `order` is emptied — so there is no leader
   * for the judge to re-offer its window to either.
   */
  held?: boolean
  /** Question text revealed so far, in order. Stripped from player views. */
  fragments?: string[]
  /**
   * The whole question, sent at the arm so the board can lay it out before a
   * word of it is spoken — the revealed prefix is `fragments.join(' ')`, and
   * what is past that renders invisible rather than absent, which is what stops
   * every line reflowing as the next clause lands.
   *
   * Never reaches a player. `viewFor` strips it unconditionally, including when
   * `mirrorFragments` is on: the mirror is a record of what the room has
   * already heard, and this is the opposite of that.
   */
  whole?: string
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
  /** Derived by the module for the host; never persisted or sent to phones. */
  status?: ModeStatus
}

export type ModeStatus = { label: string; tone: 'active' | 'inactive' }

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
  /** The seated pair, once the host closes the window (or an instant rule resolves). */
  seated?: [PlayerId, PlayerId]
  /** Seated players who answered wrong this question — drives the exclusive rebound. */
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
  attemptId?: string
}

/** One stretch of the night: N questions of one mode, optionally as duels. */
export type SetlistBlock = {
  /** Module id, into the same catalog the host settings form renders from. */
  game: string
  /** Values for that module's option schema; sanitized when applied. */
  options: Record<string, unknown>
  /** Questions in this block. */
  count: number
  /** Pack the reader takes them from. Absent = nothing to read; you read it. */
  pack?: string
  /** Round value for the block. Absent = leave whatever the host set. */
  value?: number
  /** Duel rule id, opened before every question in the block. */
  duel?: string
}

/**
 * The setlist and where the room is in it. Rides State, so snapshot, undo and
 * broadcast come free — the same bargain `duel` and `items` take.
 */
export type SetlistState = {
  blocks: SetlistBlock[]
  /** Index of the running block. Equals blocks.length when the setlist is spent. */
  at: number
  /** Questions gone by inside the current block. */
  done: number
}

/**
 * Private pack progress for host and board. The public `readingActive` fact
 * tells every screen whether the reader drives the question. Neither is saved
 * or restored by undo; the reader owns playback and stops on restoration.
 */
export type ReadingState = {
  pack: string
  qIndex: number
  qTotal: number
  fragIndex: number
  fragTotal: number
  paused: boolean
  /** Present only while a freshly selected pack is being synthesised. */
  rendering?: { done: number; total: number }
}

export type ReadingUpdate = { progress: ReadingState; active: boolean }

/** A solo crew uses the same player for both roles. */
export type TankCrew = { id: string; driver: PlayerId; gunner: PlayerId }

export type MinigameId = 'bow'
export type MinigamePhase = 'ready' | 'countdown' | 'playing' | 'results'
export type MinigameResult = { playerId: PlayerId; points: number; shots: number }
export type MinigameState = {
  id: MinigameId
  matchId: string
  phase: MinigamePhase
  /** The runtime owns duration and seed; each minigame adds its own numeric options. */
  options: { durationSec: number; seed: number } & Record<string, number>
  participants: PlayerId[]
  startsAt?: number
  endsAt?: number
  results?: MinigameResult[]
}

export type BowInput =
  | { kind: 'aim'; angle: number; tension: number }
  | { kind: 'release'; at: number }

export type TankInput =
  | { kind: 'wheel'; turns: number; part?: 'hull' | 'turret' }
  | { kind: 'drive'; dir: -1 | 0 | 1 }
  | { kind: 'trigger'; weapon: 'gun' | 'cannon'; down: boolean; at: number }

export type MinigameInputMsg = {
  t: 'minigameInput'
  matchId: string
  seq: number
  input: BowInput | TankInput
}

export type MinigameInputAck = {
  matchId: string
  seq: number
  status: 'accepted' | 'refused'
  reason?: 'stale-match' | 'not-playing' | 'not-participant' | 'invalid' | 'reloading' | 'capacity' | 'destroyed'
}

export type BowFramePlayer = {
  id: PlayerId
  origin: { x: number; y: number }
  aim: { angle: number; tension: number }
  score: number
  reloadUntilMs: number
}

export type BowFrameArrow = {
  id: string
  playerId: PlayerId
  position: { x: number; y: number }
  angle: number
  state: 'flying' | 'lodged-target' | 'lodged-boundary'
  tailKick: number
}

type BowFrameBase = { id: MinigameId; matchId: string; tick: number; serverTime: number }
export type MinigameFrame =
  | (BowFrameBase & {
      role: 'board'
      field: { width: number; height: number }
      targets: { id: string; center: { x: number; y: number }; radius: number }[]
      players: BowFramePlayer[]
      arrows: BowFrameArrow[]
    })
  | (BowFrameBase & { role: 'player'; player: BowFramePlayer; trajectory: { x: number; y: number }[] })
  | (BowFrameBase & { role: 'spectator' })

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
  grouping: Grouping
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
  setlist?: SetlistState
  /** Saved setlist filenames on disk. Filenames only, like `packs`. */
  setlists: string[]
  /** Pack filenames on disk. Filenames only — question content never enters State. */
  packs: string[]
  /** Questions per pack. A count is not content, and the builder needs it. */
  packSizes: Record<string, number>
  /** Whether players see round.fragments. Off for quizbowl: reading a whole
   *  sentence at its start beats hearing it word by word. */
  mirrorFragments: boolean
  /** Seconds a locked-in player has to speak before silence scores wrong. 0 = no timeout. */
  answerWindowSec: number
  /** Hands-off reading: the reader supplies its own N and paces the beats. */
  autoplay: Autoplay
  /** Public gameplay fact, independent of private pack progress. */
  readingActive: boolean
  reading?: ReadingState
  /** Durable lifecycle only. The live world travels in role-specific frames. */
  minigame?: MinigameState
}

export type HostAction =
  | { a: 'arm' }
  | { a: 'correct' }
  | { a: 'wrong'; neg: number }
  /** Opens a rebound the miss is still holding. No-op if none is held. */
  | { a: 'rebound' }
  | { a: 'next' }
  | { a: 'resetRound' }
  | { a: 'undo' }
  | { a: 'setValue'; value: number }
  | { a: 'setAnswerWindow'; sec: number }
  | { a: 'setScore'; key: ScoreKey; score: number }
  | { a: 'rename'; playerId: PlayerId; name: string }
  | { a: 'kick'; playerId: PlayerId }
  | { a: 'setGrouping'; grouping: Grouping }
  | { a: 'addTeam'; name: string; color: string }
  | { a: 'assign'; playerId: PlayerId; teamId?: TeamId }
  /** `keepScores` is the setlist crossing a block boundary; a host switch resets. */
  | { a: 'setMode'; id: string; options: Record<string, unknown>; keepScores?: boolean }
  | { a: 'setMirror'; on: boolean }
  /** The whole triple every time: one edit, one undo step, no partial merge. */
  | { a: 'setAutoplay'; on: boolean; nextSec: number; reboundSec: number }
  | { a: 'openDuel'; rule: string }
  /** ids = host override (and the only path for resolve:'host' rules); absent = resolve by rule. */
  | { a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }
  | { a: 'cancelDuel' }
  /** The builder writes the whole array: one edit, one undo step. Empty clears. */
  | { a: 'setSetlist'; blocks: SetlistBlock[] }
  | { a: 'setlistJump'; at: number }
  | { a: 'clearSetlist' }
  | { a: 'prepareMinigame'; id: MinigameId; options: Record<string, unknown> }
  | { a: 'startMinigame' }
  | { a: 'cancelMinigame' }
  | { a: 'closeMinigame' }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }
  /** Module and item actions. Dispatched by the hub; unknown acts are dropped. */
  | { t: 'act'; act: string; data?: unknown }
  | MinigameInputMsg

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; serverTime: number }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'state'; state: State }
  | { t: 'actionResult'; action: HostAction['a'] | 'loadSetlist'; result: ActionResult }
  | { t: 'minigameFrame'; frame: MinigameFrame }
  | { t: 'minigameAck'; ack: MinigameInputAck }

/** A command outcome, distinct from the state updates it may produce. */
export type ActionResult =
  | { status: 'applied' | 'unchanged' }
  | { status: 'refused'; reason: Refusal }
  | { status: 'failed'; message: string }
