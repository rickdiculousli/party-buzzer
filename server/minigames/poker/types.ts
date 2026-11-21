import type {
  Card, PlayerId, PokerFeedEntry, PokerFlick, PokerLegal, PokerPotResult, PokerStreet, ReactKind,
} from '../../../shared/protocol.ts'
import type { Pot } from './pots.ts'

export type PokerOptions = { stack: number; bigBlind: number; levelMin: number; shotSec: number; evaluations?: number }

export type Phase =
  | { at: 'deal'; until: number }
  | { at: 'bet' }
  | { at: 'reveal'; until: number }
  | { at: 'runout'; until: number }
  | { at: 'showdown'; until: number }
  | { at: 'muck'; until: number; winner: PlayerId; shown: boolean }
  | { at: 'over' }

export type Seat = {
  player: PlayerId
  stack: number
  startStack: number
  hole: [Card, Card] | null
  bet: number
  contributed: number
  folded: boolean
  acted: boolean
  mayRaise: boolean
  connected: boolean
  faceUp: boolean
  out: boolean
}

export type PokerWorld = {
  tick: number
  seed: number
  deckSeed: number
  opts: PokerOptions
  evaluations: number
  seats: Seat[]
  busted: { player: PlayerId; place: number }[]
  button: number
  sbSeat: number
  bbSeat: number
  handNo: number
  elapsedBase: number
  bb: number
  sb: number
  street: PokerStreet
  board: Card[]
  deck: Card[]
  actor: number | null
  actFrom: number
  actBy: number | null
  highBet: number
  raiseSize: number
  pots: Pot[]
  showdown: PokerPotResult[] | null
  runout: boolean
  equity: Record<PlayerId, number> | null
  feed: PokerFeedEntry[]
  nextFeedId: number
  reactions: { id: number; player: PlayerId; kind: ReactKind }[]
  lastReact: Record<PlayerId, number>
  phase: Phase
  saved: PokerCheckpoint | null
}

export type PokerCheckpoint = {
  seed: number
  deckSeed: number
  seats: { player: PlayerId; stack: number; out: boolean }[]
  busted: { player: PlayerId; place: number }[]
  button: number
  handNo: number
  elapsed: number
}

export type PokerAction =
  | { kind: 'fold'; flick?: PokerFlick }
  | { kind: 'check' | 'call' | 'allIn' | 'show' }
  | { kind: 'raise'; to: number }

export type Legal = PokerLegal
