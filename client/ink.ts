import type { InkPoint, InkStepView, InkStrokeView, InkTeamName, MinigameTouch, State } from '../shared/protocol.ts'

export const TOUCH_MS = 600
export const FORCE_MS = 2_000
export const ROW_ASPECT = 5
export const TEAM_LABEL: Record<InkTeamName, string> = { sun: 'Sun', moon: 'Moon' }

export type TimedTouch = MinigameTouch & { at: number }

export const teamCap = (connected: number) => Math.ceil(connected / 2)

export function lobbyColumns(state: State) {
  const lobby = state.minigame?.lobby ?? { teams: {}, volunteers: [], ready: [] }
  const connected = state.players.filter((player) => player.connected)
  const cap = teamCap(connected.length)
  return (['sun', 'moon'] as const).map((team) => {
    const members = connected
      .filter((player) => lobby.teams[player.id] === team)
      .map((player) => ({ id: player.id, name: player.name, volunteer: lobby.volunteers.includes(player.id) }))
    return { team, members, count: members.length, cap, over: members.length > cap }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

export function strokePath(points: InkPoint[], width: number, height: number): string {
  const [first, ...rest] = points.map(([x, y]) => `${round(x * width)} ${round(y * height)}`)
  if (!first) return ''
  return rest.length ? `M${first}L${rest.join('L')}` : `M${first}l0.01 0`
}

export const freshTouches = (touches: TimedTouch[], now: number) => touches.filter((touch) => now - touch.at <= TOUCH_MS)

export function stepLine(frame: { step: InkStepView; turn: InkTeamName }, nameOf: (id: string) => string): string {
  const team = TEAM_LABEL[frame.turn]
  const s = frame.step
  switch (s.at) {
    case 'choosing': return 'Writers are choosing the secret word'
    case 'peekPick': return `${team} is picking a clue to peek`
    case 'peekWrite': return `${TEAM_LABEL[s.team]} writer adds one letter`
    case 'choose': return `${team}: Ask or Guess?`
    case 'offer': return `${team} is choosing prompts`
    case 'keep': return `${team} writer is picking a prompt`
    case 'clue': return s.stopped ? `${team} called Stop` : `${team} writer is writing`
    case 'guess': return s.holder ? `${nameOf(s.holder)} is spelling the guess` : `${team} is guessing`
    case 'over': return s.winner ? `${TEAM_LABEL[s.winner]} wins` : 'Both teams lose'
  }
}

export function waitLine(step: InkStepView, turn: InkTeamName, mine: InkTeamName): string {
  const side = turn === mine ? 'Your team' : 'Other team'
  switch (step.at) {
    case 'choosing': return 'Writers choosing the word'
    case 'peekPick': return `${side} · picking a peek`
    case 'peekWrite': return `${side} · writer peeking`
    case 'choose': return `${side} · deciding`
    case 'offer': return `${side} · choosing prompts`
    case 'keep': return `${side} · writer picking`
    case 'clue': return `${side} · writer writing`
    case 'guess': return `${side} · guessing`
    case 'over': return 'Game over'
  }
}

export const DRAFT_MS = 5_000

export type InkDraft = { sent: number; strokes: InkStrokeView[]; lastOp: 'stroke' | 'undo' | 'clear'; at: number }

export function liveDraft(draft: InkDraft | null, processed: number, now: number): InkDraft | null {
  return draft && processed < draft.sent && now - draft.at < DRAFT_MS ? draft : null
}

export function draftStroke(draft: InkDraft | null, server: { processed: number; strokes: InkStrokeView[] }, stroke: InkStrokeView, now: number): InkDraft {
  const base = draft ?? { sent: server.processed, strokes: server.strokes }
  return { sent: base.sent + 1, strokes: [...base.strokes, stroke], lastOp: 'stroke', at: now }
}

export function draftUndo(draft: InkDraft | null, server: { processed: number; strokes: InkStrokeView[] }, now: number): InkDraft {
  const base = draft ?? { sent: server.processed, strokes: server.strokes }
  return { sent: base.sent + 1, strokes: base.strokes.slice(0, -1), lastOp: 'undo', at: now }
}

export function draftClear(draft: InkDraft | null, server: { processed: number; strokes: InkStrokeView[] }, now: number): InkDraft {
  const base = draft ?? { sent: server.processed, strokes: server.strokes }
  return { sent: base.sent + 1, strokes: [], lastOp: 'clear', at: now }
}

export const draftCanUndo = (draft: InkDraft | null, serverCanUndo: boolean) =>
  draft ? draft.lastOp === 'stroke' : serverCanUndo
