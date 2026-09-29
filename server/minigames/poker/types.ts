import type {
  Card, PlayerId, PokerFeedEntry, PokerFlick, PokerLegal, PokerPotResult, PokerStreet, ReactKind,
} from '../../../shared/protocol.ts'
import type { Pot } from './pots.ts'

export type PokerOptions = { stack: number; bigBlind: number; levelMin: number; shotSec: number }

/** Timed phases hold until a tick. */
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
  /** The stack as this hand began, which places players who bust together. */
  startStack: number
  hole: [Card, Card] | null
  /** Chips put in on this street. */
  bet: number
  /** Chips put in on earlier streets of this hand. */
  contributed: number
  folded: boolean
  /** Has acted since the street began or the last raise. */
  acted: boolean
  /** May still raise: false once this seat has acted, until someone makes a full raise. */
  mayRaise: boolean
  connected: boolean
  faceUp: boolean
  out: boolean
}

export type PokerWorld = {
  tick: number
  seed: number
  opts: PokerOptions
  seats: Seat[]
  busted: { player: PlayerId; place: number }[]
  button: number
  sbSeat: number
  bbSeat: number
  handNo: number
  /** Level ticks played before this world began, from a checkpoint. */
  elapsedBase: number
  bb: number
  sb: number
  street: PokerStreet
  board: Card[]
  deck: Card[]
  actor: number | null
  actBy: number | null
  highBet: number
  /** The smallest raise increment allowed on this street. */
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
  /** Taken as the current hand began, before its blinds. */
  saved: PokerCheckpoint | null
}

/** Enough to deal a hand again: its deck follows from seed and hand number. */
export type PokerCheckpoint = {
  seed: number
  seats: { player: PlayerId; stack: number; out: boolean }[]
  busted: { player: PlayerId; place: number }[]
  /** The button before this hand moved it. */
  button: number
  handNo: number
  /** Level ticks played before this hand. */
  elapsed: number
}

export type PokerAction =
  | { kind: 'fold'; flick?: PokerFlick }
  | { kind: 'check' | 'call' | 'allIn' | 'show' }
  | { kind: 'raise'; to: number }

export type Legal = PokerLegal
