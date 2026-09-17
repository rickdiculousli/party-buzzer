import { INK_PEEK_ROWS } from '../../../shared/protocol.ts'
import type { InkPoint, InkRoster, InkRowView, InkStrokeView, InkTeamName, PlayerId } from '../../../shared/protocol.ts'
import type { InputOutcome } from '../definition.ts'
import type { InkCards } from './cards.ts'

export const INK_ROWS = 8
export const HAND_SIZE = 7
export const ASK_DRAW = 2
export const PEEK_ROWS = INK_PEEK_ROWS
export const TEAMS: InkTeamName[] = ['sun', 'moon']

export type Outcome = InputOutcome

/** The pad is serialized straight to the wire, so rows are the view type. */
export type InkStroke = InkStrokeView
export type InkRow = InkRowView

export type InkStep =
  | { at: 'choosing' }
  | { at: 'peekPick' }
  | { at: 'peekWrite'; team: InkTeamName; row: number; from: number }
  | { at: 'choose' }
  | { at: 'offer' }
  | { at: 'keep'; offered: [number, number] }
  | { at: 'clue'; prompt: number; stopped: boolean }
  | { at: 'guess'; holder: PlayerId | null }
  | { at: 'over'; winner: InkTeamName | null }

export type InkVote = { player: PlayerId; choice: string; seq: number }

export type InkWorld = {
  rand: () => number
  tick: number
  cards: InkCards
  roster: InkRoster
  deck: number[]
  discard: number[]
  hands: Record<InkTeamName, number[]>
  asked: Record<InkTeamName, number[]>
  redrawn: Record<InkTeamName, boolean>
  wordCard: string[]
  picks: Partial<Record<InkTeamName, number>>
  secret: string | null
  pad: Record<InkTeamName, InkRow[]>
  padVersion: number
  sentVersion: number
  nextPadTick: number
  turn: InkTeamName
  /** The turn team's row for this turn. */
  row: number
  step: InkStep
  votes: InkVote[]
  voteSeq: number
  live: Record<PlayerId, InkPoint[]>
  undoable: { team: InkTeamName; row: number; player: PlayerId } | null
  /** Stroke and undo inputs processed per player, accepted or not. Phones compare it with what they sent. */
  inkOps: Record<PlayerId, number>
}
