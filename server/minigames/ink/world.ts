import type { InkInput, InkPoint, InkTeamName, MinigameLobby, MinigameResult, PlayerId } from '../../../shared/protocol.ts'
import type { InkCards } from './cards.ts'
import {
  ASK_DRAW, HAND_SIZE, INK_ROWS, PEEK_ROWS, TEAMS,
  type InkRow, type InkVote, type InkWorld, type Outcome,
} from './types.ts'

const OK: Outcome = { status: 'accepted' }
const NO: Outcome = { status: 'refused', reason: 'not-allowed' }
const MAX_POINTS = 500

export const otherTeam = (team: InkTeamName): InkTeamName => team === 'sun' ? 'moon' : 'sun'

function shuffle<T>(rand: () => number, items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const emptyRow = (): InkRow => ({ kind: null, strokes: [], strikes: [], ended: false })

export function createInkWorld(input: {
  rand: () => number
  cards: InkCards
  lobby: MinigameLobby
  participants: PlayerId[]
}): InkWorld {
  const { rand, cards, lobby, participants } = input
  const roster = {} as InkWorld['roster']
  for (const team of TEAMS) {
    const members = participants.filter((id) => lobby.teams[id] === team)
    const volunteers = members.filter((id) => lobby.volunteers.includes(id))
    const pool = volunteers.length ? volunteers : members
    const writer = pool[Math.floor(rand() * pool.length)]
    roster[team] = { writer, guessers: members.filter((id) => id !== writer) }
  }
  const w: InkWorld = {
    rand, tick: 0, cards, roster,
    deck: shuffle(rand, cards.prompts.map((_, i) => i)),
    discard: [],
    hands: { sun: [], moon: [] },
    asked: { sun: [], moon: [] },
    redrawn: { sun: false, moon: false },
    wordCard: cards.words[Math.floor(rand() * cards.words.length)],
    picks: {},
    secret: null,
    pad: { sun: Array.from({ length: INK_ROWS }, emptyRow), moon: Array.from({ length: INK_ROWS }, emptyRow) },
    padVersion: 0, sentVersion: -1, nextPadTick: 0,
    turn: 'sun', row: 0,
    step: { at: 'choosing' },
    votes: [], voteSeq: 0, live: {}, undoable: null, checked: 0,
  }
  for (const team of TEAMS) draw(w, team, HAND_SIZE)
  return w
}

export function roleOf(w: InkWorld, playerId: PlayerId): { team: InkTeamName; role: 'writer' | 'guesser' } | null {
  for (const team of TEAMS) {
    if (w.roster[team].writer === playerId) return { team, role: 'writer' }
    if (w.roster[team].guessers.includes(playerId)) return { team, role: 'guesser' }
  }
  return null
}

function draw(w: InkWorld, team: InkTeamName, count: number): void {
  for (let i = 0; i < count; i++) {
    if (w.deck.length === 0) {
      w.deck = shuffle(w.rand, w.discard)
      w.discard = []
    }
    const card = w.deck.pop()
    if (card === undefined) return
    w.hands[team].push(card)
  }
}

const bump = (w: InkWorld) => { w.padVersion++ }

export function peekTargets(w: InkWorld): string[] {
  const out: string[] = []
  for (const team of TEAMS) {
    w.pad[team].forEach((row, i) => {
      if (row.kind === 'clue' && !row.ended && row.strokes.length > 0) out.push(`${team}:${i}`)
    })
  }
  return out
}

function beginTurn(w: InkWorld, team: InkTeamName): void {
  w.turn = team
  w.votes = []
  w.live = {}
  w.undoable = null
  const row = w.pad[team].findIndex((r) => r.kind === null)
  if (row < 0) {
    w.step = { at: 'over', winner: null }
    return
  }
  w.row = row
  w.step = PEEK_ROWS[team].includes(row + 1) && peekTargets(w).length > 0 ? { at: 'peekPick' } : { at: 'choose' }
}

const endTurn = (w: InkWorld) => beginTurn(w, otherTeam(w.turn))
const turnRow = (w: InkWorld) => w.pad[w.turn][w.row]

export function leadingChoice(votes: InkVote[]): string | null {
  const tally = new Map<string, { count: number; reached: number }>()
  for (const vote of votes) {
    const entry = tally.get(vote.choice) ?? { count: 0, reached: 0 }
    entry.count++
    entry.reached = Math.max(entry.reached, vote.seq)
    tally.set(vote.choice, entry)
  }
  let best: string | null = null
  let top = { count: 0, reached: Infinity }
  for (const [choice, entry] of tally) {
    if (entry.count > top.count || (entry.count === top.count && entry.reached < top.reached)) {
      best = choice
      top = entry
    }
  }
  return best
}

function promptPair(w: InkWorld, choice: string): [number, number] | null {
  const parts = choice.split(',').map(Number)
  if (parts.length !== 2 || parts[0] === parts[1]) return null
  if (!parts.every((id) => w.hands[w.turn].includes(id))) return null
  return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])]
}

function validChoice(w: InkWorld, choice: string): boolean {
  if (w.step.at === 'choose') {
    return (choice === 'ask' && w.hands[w.turn].length >= 2) || choice === 'guess'
      || (choice === 'redraw' && !w.redrawn[w.turn])
  }
  if (w.step.at === 'offer') return promptPair(w, choice) !== null
  if (w.step.at === 'peekPick') return peekTargets(w).includes(choice)
  return false
}

/** Prompt pairs compare as sets. */
const normalize = (w: InkWorld, choice: string) =>
  w.step.at === 'offer' ? promptPair(w, choice)?.join(',') ?? choice : choice

function resolve(w: InkWorld, choice: string): void {
  w.votes = []
  const team = w.turn
  if (w.step.at === 'choose') {
    if (choice === 'ask') w.step = { at: 'offer' }
    else if (choice === 'guess') {
      turnRow(w).kind = 'guess'
      w.checked = 0
      w.step = { at: 'guess', holder: null }
      bump(w)
    } else {
      w.discard.push(...w.hands[team])
      w.hands[team] = []
      draw(w, team, HAND_SIZE)
      w.redrawn[team] = true
    }
  } else if (w.step.at === 'offer') {
    const pair = promptPair(w, choice)!
    w.hands[team] = w.hands[team].filter((id) => !pair.includes(id))
    w.step = { at: 'keep', offered: pair }
  } else if (w.step.at === 'peekPick') {
    const [rowTeam, index] = choice.split(':') as [InkTeamName, string]
    const row = Number(index)
    w.step = { at: 'peekWrite', team: rowTeam, row, from: w.pad[rowTeam][row].strokes.length }
  }
}

export function validPoints(points: unknown): points is InkPoint[] {
  return Array.isArray(points) && points.length > 0 && points.length <= MAX_POINTS && points.every((p) =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= 0 && n <= 1))
}

const quantize = (points: InkPoint[]): InkPoint[] =>
  points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])

export function inkTarget(w: InkWorld, playerId: PlayerId): { team: InkTeamName; row: number; peek: boolean } | null {
  const s = w.step
  const role = roleOf(w, playerId)
  if (!role) return null
  if (s.at === 'clue' && role.role === 'writer' && role.team === w.turn) return { team: w.turn, row: w.row, peek: false }
  if (s.at === 'peekWrite' && w.roster[s.team].writer === playerId) return { team: s.team, row: s.row, peek: true }
  if (s.at === 'guess' && role.role === 'guesser' && role.team === w.turn && (s.holder === null || s.holder === playerId)) {
    return { team: w.turn, row: w.row, peek: false }
  }
  return null
}

function finishClue(w: InkWorld, ended: boolean): void {
  if (w.step.at !== 'clue') return
  turnRow(w).ended = ended
  w.asked[w.turn].push(w.step.prompt)
  draw(w, w.turn, ASK_DRAW)
  bump(w)
  endTurn(w)
}

export function applyInk(w: InkWorld, playerId: PlayerId, input: InkInput): Outcome {
  const role = roleOf(w, playerId)
  if (!role) return NO
  const s = w.step
  const turnGuesser = role.role === 'guesser' && role.team === w.turn
  const turnWriter = role.role === 'writer' && role.team === w.turn

  switch (input.kind) {
    case 'pickWord': {
      if (s.at !== 'choosing' || role.role !== 'writer') return NO
      if (!Number.isInteger(input.index) || input.index < 0 || input.index >= w.wordCard.length) return NO
      w.picks[role.team] = input.index
      if (w.picks.sun !== undefined && w.picks.sun === w.picks.moon) {
        w.secret = w.wordCard[input.index]
        beginTurn(w, 'sun')
      }
      return OK
    }
    case 'vote': {
      if (!turnGuesser || typeof input.choice !== 'string') return NO
      if (input.choice && !validChoice(w, input.choice)) return NO
      const choice = normalize(w, input.choice)
      w.votes = w.votes.filter((vote) => vote.player !== playerId)
      if (!choice) return OK
      w.votes.push({ player: playerId, choice, seq: ++w.voteSeq })
      const guessers = w.roster[w.turn].guessers
      if (guessers.every((id) => w.votes.some((vote) => vote.player === id && vote.choice === choice))) resolve(w, choice)
      return OK
    }
    case 'force': {
      if (!turnGuesser) return NO
      const choice = leadingChoice(w.votes)
      if (!choice || !validChoice(w, choice)) return NO
      resolve(w, choice)
      return OK
    }
    case 'keep': {
      if (s.at !== 'keep' || !turnWriter || !s.offered.includes(input.prompt)) return NO
      w.discard.push(s.offered.find((id) => id !== input.prompt)!)
      turnRow(w).kind = 'clue'
      w.step = { at: 'clue', prompt: input.prompt, stopped: false }
      bump(w)
      return OK
    }
    case 'ink': {
      if (!inkTarget(w, playerId) || !validPoints(input.points)) return NO
      w.live[playerId] = quantize(input.points)
      return OK
    }
    case 'stroke': {
      const target = inkTarget(w, playerId)
      if (!target || !validPoints(input.points)) return NO
      const row = w.pad[target.team][target.row]
      row.strokes.push({ points: quantize(input.points), author: playerId, ...(target.peek ? { peek: true as const } : {}) })
      if (s.at === 'guess') s.holder = playerId
      w.undoable = { team: target.team, row: target.row, player: playerId }
      delete w.live[playerId]
      bump(w)
      return OK
    }
    case 'undo': {
      const u = w.undoable
      const target = inkTarget(w, playerId)
      if (!u || !target || u.player !== playerId || u.team !== target.team || u.row !== target.row) return NO
      const row = w.pad[u.team][u.row]
      row.strokes.pop()
      w.undoable = null
      if (s.at === 'guess' && row.strokes.length === w.checked) s.holder = null
      bump(w)
      return OK
    }
    case 'stop': {
      if (s.at !== 'clue' || !turnGuesser || s.stopped) return NO
      s.stopped = true
      return OK
    }
    case 'done': {
      if (s.at === 'clue' && turnWriter && s.stopped) {
        finishClue(w, false)
        return OK
      }
      if (s.at === 'peekWrite' && w.roster[s.team].writer === playerId && w.pad[s.team][s.row].strokes.length > s.from) {
        w.step = { at: 'choose' }
        w.votes = []
        w.undoable = null
        delete w.live[playerId]
        return OK
      }
      return NO
    }
    case 'endClue': {
      if (s.at !== 'clue' || !turnWriter) return NO
      finishClue(w, true)
      return OK
    }
    case 'check': {
      if (s.at !== 'guess' || !turnGuesser || turnRow(w).strokes.length <= w.checked) return NO
      w.step = { at: 'judgeLetter' }
      w.undoable = null
      w.live = {}
      return OK
    }
    case 'judge': {
      if (s.at !== 'judgeLetter' || !turnWriter) return NO
      const row = turnRow(w)
      if (input.correct) {
        w.checked = row.strokes.length
        w.step = { at: 'guess', holder: null }
      } else {
        row.strikes.push([w.checked, row.strokes.length - 1])
        bump(w)
        endTurn(w)
      }
      return OK
    }
    case 'finishGuess': {
      const row = turnRow(w)
      if (s.at !== 'guess' || !turnGuesser || w.checked === 0 || row.strokes.length !== w.checked) return NO
      row.ended = true
      w.step = { at: 'judgeWord' }
      w.undoable = null
      bump(w)
      return OK
    }
    case 'verdict': {
      if (s.at !== 'judgeWord' || !turnWriter) return NO
      if (input.win) {
        turnRow(w).won = true
        w.step = { at: 'over', winner: w.turn }
        bump(w)
      } else endTurn(w)
      return OK
    }
  }
  return NO
}

export const inkFinished = (w: InkWorld) => w.step.at === 'over'

export function inkResults(w: InkWorld): MinigameResult[] {
  if (w.step.at !== 'over' || !w.step.winner) return []
  const { writer, guessers } = w.roster[w.step.winner]
  return [writer, ...guessers].map((playerId) => ({ playerId, points: 1, shots: 0 }))
}
