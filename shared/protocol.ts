import type { Refusal } from './legality.ts'

export type PlayerId = string
export type Card = string
export type TeamId = string
export type ScoreKey = string

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

export type BuzzEntry = {
  playerId: PlayerId
  name: string
  at: number
  deltaMs: number
  leader?: boolean
}

export const COLLECT_MS = 1000

export const BEAT_MS = 2000
export const BEAT_MISSES = 3

export type Award = { name: string; points: number; penalty?: true }

export function isPenalty(award: Award | undefined): boolean {
  return !!award && (award.penalty === true || award.points < 0)
}

export type Round = {
  questionId: string
  attemptId: string
  value: number
  phase: Phase
  armedAt: number
  order: BuzzEntry[]
  total: number
  lockedOut: ScoreKey[]
  buzzable?: PlayerId[]
  award?: Award
  judge?: { until?: number }
  spoken?: { name: string; transcript: string; hit: boolean }
  held?: boolean
  fragments?: string[]
  whole?: string
  image?: string
  answer?: string
  kind?: QuestionKind
  choices?: string[]
  closesAt?: number
  picks?: Record<PlayerId, number>
  correct?: number
  guessing?: { unit?: string; closesAt: number; plain?: true }
  guesses?: Record<PlayerId, number>
  truth?: number
  paid?: Record<PlayerId, number>
  nearest?: number
  guessed?: number
  reveal?: Reveal
}

export type Reveal = { from: number; until: number; heldAt?: number }

export type QuestionKind = 'shown' | 'choice' | 'closest' | 'reveal'

export type GameState = {
  id: string
  options: Record<string, unknown>
  moduleState: unknown
  status?: ModeStatus
}

export type ModeStatus = { label: string; tone: 'active' | 'inactive' }

export type OptionSpec =
  | { kind: 'int'; key: string; label: string; hint?: string; default: number; min: number; max: number }
  | { kind: 'bool'; key: string; label: string; hint?: string; default: boolean }
  | { kind: 'choice'; key: string; label: string; hint?: string; default: string; choices: string[] }

export type GameInfo = { id: string; name: string; options: OptionSpec[]; scoreless?: boolean }

export type DuelPoolEntry = {
  playerId: PlayerId
  votes: PlayerId[]
  in: boolean
}

export type DuelState = {
  rule: string
  pool: DuelPoolEntry[]
  seated?: [PlayerId, PlayerId]
  missed: PlayerId[]
}

export type DuelRuleInfo = {
  id: string
  name: string
  entry: 'vote' | 'volunteer' | 'both' | 'none'
  resolve: 'votes' | 'random' | 'host'
}

export type ActiveEffect = {
  kind: 'frozen' | 'steal'
  playerId: PlayerId
  attemptId?: string
}

export type SetlistBlock = {
  game: string
  options: Record<string, unknown>
  count: number
  pack?: string
  value?: number
  duel?: string
}

export type SetlistState = {
  blocks: SetlistBlock[]
  at: number
  done: number
  spentAt?: number
}

export type ReadingState = {
  pack: string
  qIndex: number
  qTotal: number
  fragIndex: number
  fragTotal: number
  paused: boolean
  rendering?: { done: number; total: number }
}

export type ReadingUpdate = { progress: ReadingState; active: boolean }

export type TankCrew = { id: string; driver: PlayerId; gunner: PlayerId }

export type MinigameId = 'bow' | 'tank' | 'ink' | 'sketch' | 'poker' | 'tug'

export const MINIGAME_OPTIONS: Record<MinigameId, Extract<OptionSpec, { kind: 'int' }>[]> = {
  bow: [
    { kind: 'int', key: 'durationSec', label: 'Time limit', hint: 'Seconds', default: 40, min: 5, max: 180 },
    { kind: 'int', key: 'reloadMs', label: 'Reload', hint: 'Milliseconds between shots', default: 100, min: 0, max: 5_000 },
  ],
  tank: [{ kind: 'int', key: 'durationSec', label: 'Time limit', hint: 'Seconds', default: 40, min: 5, max: 180 }],
  ink: [],
  sketch: [
    { kind: 'int', key: 'drawSec', label: 'Drawing time', hint: 'Seconds per turn', default: 80, min: 30, max: 180 },
    { kind: 'int', key: 'drawers', label: 'Drawers', hint: 'How many take a turn; 0 means everyone', default: 0, min: 0, max: 30 },
  ],
  poker: [
    { kind: 'int', key: 'stack', label: 'Starting stack', hint: 'Chips each player sits down with', default: 1500, min: 100, max: 100_000 },
    { kind: 'int', key: 'bigBlind', label: 'Starting big blind', hint: 'Chips; the small blind is half', default: 20, min: 2, max: 10_000 },
    { kind: 'int', key: 'levelMin', label: 'Level length', hint: 'Minutes before the blinds double', default: 10, min: 1, max: 60 },
    { kind: 'int', key: 'shotSec', label: 'Shot clock', hint: 'Seconds to act, then you check or fold', default: 30, min: 5, max: 120 },
  ],
  tug: [
    { kind: 'int', key: 'durationSec', label: 'Time limit', hint: 'Seconds', default: 30, min: 10, max: 120 },
    { kind: 'int', key: 'value', label: 'Points per winner', hint: 'Everyone on the winning side gains this', default: 100, min: 0, max: 1_000 },
  ],
}

export const isMinigameId = (id: string): id is MinigameId => Object.hasOwn(MINIGAME_OPTIONS, id)
export type MinigamePhase = 'ready' | 'countdown' | 'playing' | 'results'
export type MinigameResult = { playerId: PlayerId; points: number; shots: number; place?: number }

export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river'
export const POKER_DEAL = { gapMs: 260, roundMs: 750 }
export const pokerDealSpan = (seats: number) => (seats * 2 - 2) * POKER_DEAL.gapMs + POKER_DEAL.roundMs - POKER_DEAL.gapMs
export type ReactKind = 'nice' | 'ouch' | 'bluff' | 'wow'
export const REACT_LABEL: Record<ReactKind, string> = { nice: 'Nice hand', ouch: 'Ouch', bluff: 'Bluff?', wow: 'Wow' }
export type PokerFlick = { dx: number; dy: number; speed: number }
export type PokerFeedKind = 'blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'show' | 'win' | 'bust' | 'level'
export type PokerFeedEntry = {
  id: number
  player: PlayerId | null
  kind: PokerFeedKind
  amount?: number
  flick?: PokerFlick
  auto?: true
  hand?: string
}
export type PokerPotResult = { winners: PlayerId[]; name: string; five: Card[]; amount: number }
export type PokerLegal = { canCheck: boolean; call: number; canRaise: boolean; canAllIn: boolean; minTo: number; maxTo: number }
export type PokerPhase = 'deal' | 'bet' | 'reveal' | 'runout' | 'showdown' | 'muck' | 'over'

export type PokerInput =
  | { kind: 'fold'; flick?: PokerFlick; at: number }
  | { kind: 'check' | 'call' | 'allIn' | 'show'; at: number }
  | { kind: 'raise'; to: number; at: number }
  | { kind: 'react'; react: ReactKind; at: number }

export type PokerSeatView = {
  player: PlayerId
  stack: number
  bet: number
  button: boolean
  sb: boolean
  bb: boolean
  folded: boolean
  allIn: boolean
  busted: boolean
  place: number | null
  away: boolean
  cards: [Card, Card] | null
}

export type PokerShared = {
  phase: PokerPhase
  street: PokerStreet
  seats: PokerSeatView[]
  board: Card[]
  pots: number[]
  actor: PlayerId | null
  actBy: number | null
  handNo: number
  sb: number
  bb: number
  nextLevelAt: number
  equity: Record<PlayerId, number> | null
  runout: boolean
  showdown: PokerPotResult[] | null
  feed: PokerFeedEntry[]
  reactions: { id: number; player: PlayerId; kind: ReactKind }[]
}

export type PokerPrivate = {
  hole: [Card, Card] | null
  legal: PokerLegal | null
  canShow: boolean
  place: number | null
}

export type InkTeamName = 'sun' | 'moon'

export const INK_PEEK_ROWS: Record<InkTeamName, number[]> = { sun: [4, 6, 7], moon: [3, 5, 6] }
export const INK_REACH = { min: -1, max: 2 }

export function quantizePoint(x: number, y: number): InkPoint {
  const q = (n: number) => Math.round(Math.min(INK_REACH.max, Math.max(INK_REACH.min, n)) * 1000) / 1000
  return [q(x), q(y)]
}

export const MAX_STROKE_POINTS = 500

export function validPoints(points: unknown): points is InkPoint[] {
  return Array.isArray(points) && points.length > 0 && points.length <= MAX_STROKE_POINTS && points.every((p) =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= INK_REACH.min && n <= INK_REACH.max))
}

export type MinigameLobby = {
  teams: Record<PlayerId, InkTeamName>
  volunteers: PlayerId[]
  ready: PlayerId[]
}

export type LobbyChange =
  | { do: 'join'; team: InkTeamName }
  | { do: 'leave' }
  | { do: 'volunteer'; on: boolean }
  | { do: 'ready'; on: boolean }

export type MinigameTouch = { playerId: PlayerId; name: string; target: string; x: number; y: number }

export type MinigameState = {
  id: MinigameId
  matchId: string
  phase: MinigamePhase
  options: { durationSec: number; seed: number } & Record<string, number>
  participants: PlayerId[]
  startsAt?: number
  endsAt?: number
  results?: MinigameResult[]
  crews?: TankCrew[]
  lobby?: MinigameLobby
  checkpoint?: MinigameCheckpoint
  status?: { text: string; until?: number }[]
}

export type MinigameCheckpoint = { version: number; label: string; data?: unknown }

export type BowInput =
  | { kind: 'aim'; angle: number; tension: number }
  | { kind: 'release'; at: number }

export type TugInput = { kind: 'pull' }

export type TankInput =
  | { kind: 'wheel'; turns: number; part?: 'hull' | 'turret' }
  | { kind: 'turn'; rate: number; part?: 'hull' | 'turret' }
  | { kind: 'turretAim'; angle: number }
  | { kind: 'hullAim'; angle: number }
  | { kind: 'drive'; dir: -1 | 0 | 1 }
  | { kind: 'trigger'; weapon: 'gun' | 'cannon'; down: boolean; at: number }

export type InkPoint = [number, number]

export type InkInput =
  | { kind: 'pickWord'; index: number; at: number }
  | { kind: 'vote'; choice: string; at: number }
  | { kind: 'force'; at: number }
  | { kind: 'keep'; prompt: number; at: number }
  | { kind: 'ink'; points: InkPoint[] }
  | { kind: 'stroke'; points: InkPoint[]; at: number }
  | { kind: 'undo'; at: number }
  | { kind: 'stop'; at: number }
  | { kind: 'done'; at: number }
  | { kind: 'endClue'; at: number }
  | { kind: 'letter'; value: string; at: number }

export type SketchStep = 'choosing' | 'drawing' | 'reveal' | 'over'
export type SketchEnd = 'all' | 'timeup' | 'pass'
export type SketchMiss = { seq: number; player: PlayerId; text: string }
export type SketchCorrect = { seq: number; player: PlayerId; ms: number }

export type SketchShared = {
  step: SketchStep
  drawer: PlayerId
  turn: number
  turns: number
  blanks: string
  strokes?: InkStrokeView[]
  live: InkPoint[] | null
  endsAt: number
  misses: SketchMiss[]
  correct: SketchCorrect[]
  end: SketchEnd | null
  scores: Record<PlayerId, number>
  word: string | null
}

export type SketchPrivate = {
  choices: string[]
  close: number
  inkOps: number
}

export type SketchInput =
  | { kind: 'pickWord'; index: number; at: number }
  | { kind: 'ink'; points: InkPoint[] }
  | { kind: 'stroke'; points: InkPoint[]; at: number }
  | { kind: 'undo'; at: number }
  | { kind: 'clear'; at: number }
  | { kind: 'pass'; at: number }
  | { kind: 'guess'; text: string; at: number }

export type MinigameInputMsg = {
  t: 'minigameInput'
  matchId: string
  seq: number
  input: BowInput | TankInput | InkInput | SketchInput | PokerInput | TugInput
}

export type MinigameInputAck = {
  matchId: string
  seq: number
  status: 'accepted' | 'refused'
  reason?: 'stale-match' | 'not-playing' | 'not-participant' | 'invalid' | 'reloading' | 'capacity' | 'destroyed' | 'not-allowed' | 'too-soon'
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

export type TugSide = { name: string; color: string; members: PlayerId[] }

export type TugShared = {
  sides: [TugSide, TugSide]
  flag: number
  effort: [number, number]
  endsAt: number
  winner?: 0 | 1 | null
}

type FrameBase<Id extends MinigameId> = { id: Id; matchId: string; tick: number; serverTime: number }

export type HostRow = { players: PlayerId[]; score?: number; word?: string }

export type TankFrameTank = {
  id: string
  crew: TankCrew
  position: { x: number; y: number }
  hull: number
  turret: number
  hullTarget: number | null
  hp: number
  dead: boolean
  invulnerable: boolean
  score: number
}

export type TankFrameWeapon = { clip: number; size: number; reloadUntil: number; reloadMs: number }

export type MinigameFrame =
  | (FrameBase<'bow'> & {
      role: 'board'
      field: { width: number; height: number }
      targets: { id: string; center: { x: number; y: number }; radius: number }[]
      players: BowFramePlayer[]
      arrows: BowFrameArrow[]
    })
  | (FrameBase<'bow'> & { role: 'player'; player: BowFramePlayer; trajectory: { x: number; y: number }[] })
  | (FrameBase<'tank'> & {
      role: 'board'
      field: { width: number; height: number }
      cover?: string
      coverChanged: number[]
      tanks: TankFrameTank[]
      projectiles: { id: string; weapon: 'gun' | 'cannon'; position: { x: number; y: number } }[]
      blasts: { position: { x: number; y: number }; radius: number; weapon: 'gun' | 'cannon' }[]
    })
  | (FrameBase<'tank'> & {
      role: 'player'
      crew: TankCrew
      tank: TankFrameTank & { respawnAt: number | null; gun: TankFrameWeapon; cannon: TankFrameWeapon }
    })
  | (FrameBase<'ink'> & { role: 'board' } & InkShared)
  | (FrameBase<'ink'> & { role: 'player' } & InkShared & InkPrivate)
  | (FrameBase<'sketch'> & { role: 'board' } & SketchShared)
  | (FrameBase<'sketch'> & { role: 'player' } & SketchShared & SketchPrivate)
  | (FrameBase<'poker'> & { role: 'board' } & PokerShared)
  | (FrameBase<'poker'> & { role: 'player' } & PokerShared & PokerPrivate)
  | (FrameBase<'tug'> & { role: 'board' } & TugShared)
  | (FrameBase<'tug'> & { role: 'player' } & TugShared & { side: 0 | 1; pull: number })
  | (FrameBase<MinigameId> & { role: 'host'; rows: HostRow[] })
  | (FrameBase<MinigameId> & { role: 'spectator' })

export type InkStrokeView = { points: InkPoint[]; author: PlayerId; peek?: true }
export type InkRowView = {
  kind: 'clue' | 'guess' | null
  strokes: InkStrokeView[]
  strikes: [number, number][]
  ended: boolean
  won?: true
  letters: string[]
  wrong?: true
}
export type InkRoster = Record<InkTeamName, { writer: PlayerId; guessers: PlayerId[] }>

export type InkStepView =
  | { at: 'choosing' }
  | { at: 'peekPick'; targets: string[] }
  | { at: 'peekWrite'; team: InkTeamName; row: number }
  | { at: 'choose'; canRedraw: boolean }
  | { at: 'offer' }
  | { at: 'keep' }
  | { at: 'clue'; stopped: boolean }
  | { at: 'guess'; holder: PlayerId | null }
  | { at: 'over'; winner: InkTeamName | null }

export type InkShared = {
  roster: InkRoster
  turn: InkTeamName
  row: number
  step: InkStepView
  pad?: Record<InkTeamName, InkRowView[]>
  live: { player: PlayerId; team: InkTeamName; row: number; points: InkPoint[] }[]
  discard: Record<InkTeamName, string[]>
  deck: number
  secret: string | null
}

export type InkCardView = { id: number; text: string }

export type InkPrivate = {
  me: { team: InkTeamName; role: 'writer' | 'guesser' }
  hand: InkCardView[]
  votes: { player: PlayerId; choice: string }[]
  asked: string[]
  offered: InkCardView[]
  kept: string | null
  wordCard: string[]
  picks: Partial<Record<InkTeamName, number>>
  canUndo: boolean
  inkOps: number
}

export type Arrival =
  | { kind: 'lobby'; id: string; testedPlayerIds: PlayerId[] }
  | { kind: 'introduction'; id: string; blockAt: number; blockKey: string }

export type PracticeReceipt = {
  lobbyId: string
  seq: number
  playerId: PlayerId
}

export type QuizReactKind = 'ooh' | 'noway' | 'tooslow' | 'legend'
export const QUIZ_REACT_LABEL: Record<QuizReactKind, string> = { ooh: 'Ooh', noway: 'No way', tooslow: 'Too slow', legend: 'Legend' }
export const REACT_COOLDOWN_MS = 3000
export type ReactionReceipt = {
  questionId: string
  seq: number
  playerId: PlayerId
  kind: QuizReactKind
}

export type Autoplay = {
  on: boolean
  nextSec: number
  buzzSec: number
  reboundSec: number
  introSec: number
}

export type NightFact =
  | {
      kind: 'verdict'; at: number; questionId: string; block?: number
      playerId: PlayerId; key: ScoreKey; name: string
      points: number; hit: boolean
      reactionMs?: number; marginMs?: number
      source: 'buzz' | 'choice' | 'closest'
    }
  | { kind: 'standings'; at: number; questionId?: string; matchId?: string; order: { key: ScoreKey; score: number }[] }
  | {
      kind: 'minigame'; at: number; id: MinigameId; matchId: string; block?: number
      results: { playerId: PlayerId; key: ScoreKey; name: string; points: number; place?: number }[]
    }
  | { kind: 'item'; at: number; itemId: string; playerId: PlayerId; name: string; targetId?: PlayerId; targetName?: string; questionId?: string }

export type Night = { facts: NightFact[] }

export type State = {
  grouping: Grouping
  players: Player[]
  teams: Team[]
  scores: Record<ScoreKey, number>
  round: Round
  game: GameState
  items: Record<PlayerId, string[]>
  effects: ActiveEffect[]
  games: GameInfo[]
  duel?: DuelState
  duelRules: DuelRuleInfo[]
  setlist?: SetlistState
  setlists: string[]
  packs: string[]
  packSizes: Record<string, number>
  packCost: Record<string, number>
  mirrorFragments: boolean
  answerWindowSec: number
  choiceSec: number
  revealSec: number
  autoplay: Autoplay
  readingActive: boolean
  reading?: ReadingState
  typed?: string
  minigame?: MinigameState
  arrival?: Arrival
  night?: Night
}

export type HostAction =
  | { a: 'arm'; kind?: QuestionKind }
  | { a: 'settleChoice'; correct: number }
  | { a: 'settleClosest'; truth: number }
  | { a: 'setChoiceTime'; sec: number }
  | { a: 'setRevealTime'; sec: number }
  | { a: 'correct' }
  | { a: 'wrong'; neg: number }
  | { a: 'timeUp' }
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
  | { a: 'setMode'; id: string; options: Record<string, unknown>; keepScores?: boolean }
  | { a: 'setMirror'; on: boolean }
  | { a: 'setAutoplay'; on: boolean; nextSec: number; buzzSec: number; reboundSec: number; introSec: number }
  | { a: 'openDuel'; rule: string }
  | { a: 'closeDuel'; playerIds?: [PlayerId, PlayerId] }
  | { a: 'cancelDuel' }
  | { a: 'setSetlist'; blocks: SetlistBlock[] }
  | { a: 'setlistJump'; at: number }
  | { a: 'clearSetlist' }
  | { a: 'prepareMinigame'; id: MinigameId; options: Record<string, unknown> }
  | { a: 'startMinigame' }
  | { a: 'cancelMinigame' }
  | { a: 'closeMinigame' }
  | { a: 'openLobby' }
  | { a: 'closeArrival'; arrivalId: string }
  | { a: 'clearNight' }

export type ClientMsg =
  | { t: 'hello'; role: Role; playerId?: PlayerId; name?: string }
  | { t: 'ping'; t0: number }
  | { t: 'buzz'; at: number }
  | { t: 'host'; action: HostAction }
  | { t: 'act'; act: string; data?: unknown }
  | MinigameInputMsg
  | { t: 'minigameLobby'; change: LobbyChange }
  | { t: 'minigameTouch'; matchId: string; target: string; x: number; y: number }
  | { t: 'practiceBuzz'; lobbyId: string }
  | { t: 'react'; kind: QuizReactKind }

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; serverTime: number }
  | { t: 'pong'; t0: number; serverTime: number }
  | { t: 'beat' }
  | { t: 'state'; state: State }
  | { t: 'actionResult'; action: HostAction['a'] | 'loadSetlist'; result: ActionResult }
  | { t: 'minigameFrame'; frame: MinigameFrame }
  | { t: 'minigameAck'; ack: MinigameInputAck }
  | { t: 'minigameTouch'; touch: MinigameTouch }
  | { t: 'practiceBuzz'; receipt: PracticeReceipt }
  | { t: 'reaction'; receipt: ReactionReceipt }

export type ActionResult =
  | { status: 'applied' | 'unchanged' }
  | { status: 'refused'; reason: Refusal }
  | { status: 'failed'; message: string }
