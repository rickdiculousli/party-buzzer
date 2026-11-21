import type { ActionResult, HostAction, HostRow, ScoreKey, State } from '../shared/protocol.ts'
import { isMinigameId } from '../shared/protocol.ts'
import type { Refusal } from '../shared/legality.ts'
import { MINIGAME_INFO } from './minigame-info.ts'

export const REFUSAL_TEXT: Record<Refusal, string> = {
  'not-idle': 'A round is in flight — this waits for it to end.',
  'no-leader': 'Nobody is locked in — there is nothing to judge yet.',
  'already-scored': 'This round is already scored — Undo first to change it.',
  'nothing-held': 'No miss is being held — there is no rebound to open.',
  'no-duel': 'No duel is open — there is nothing to close.',
  'duel-seated': 'The pair is already seated — Cancel ends the duel.',
  'unknown-mode': 'This room has no game by that name.',
  'unknown-duel-rule': 'This room has no duel rule by that name.',
  'no-setlist': 'There is no setlist to move through.',
  'no-players': 'No players are connected — wait for someone to join.',
  'minigame-active': 'A minigame is active — close it before changing the quiz.',
  'unpicked': 'Someone connected has not picked a team yet.',
  'team-too-small': 'Each team needs at least two players.',
  'ink-cards': 'Phantom Ink needs packs/phantom-ink.txt with at least 16 P: prompts and one W: word card.',
  'too-few-players': 'Sketch needs at least two players.',
  'sketch-words': 'Sketch needs packs/sketch-words.txt with at least three words per player.',
  'no-choice': 'No choice question is taking picks.',
  'no-guessing': 'No closest question is taking guesses.',
  'not-open': 'The buzzers are not open with nobody in.',
  'arrival-changed': 'That lobby or introduction has already moved on.',
  'introduction-active': 'The introduction is up — press Continue first.',
  'reading-active': 'The reader is running — stop it first.',
  'duel-active': 'A duel is open — finish or cancel it first.',
}

export function actionFeedback(action: HostAction['a'] | 'loadSetlist', result: ActionResult): string | null {
  if (result.status === 'refused') return REFUSAL_TEXT[result.reason]
  if (result.status === 'failed') return result.message
  if (result.status === 'unchanged' && action === 'undo') return 'Nothing to undo.'
  return null
}

const IDS = ['var(--id-1)', 'var(--id-2)', 'var(--id-3)', 'var(--id-4)', 'var(--id-5)', 'var(--id-6)']

export function colorFor(key: ScoreKey): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return IDS[Math.abs(h) % IDS.length]
}

export function chunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < words.length; ) {
    const n = out.length % 3 === 0 ? 1 : 2
    out.push(words.slice(i, i + n).join(' '))
    i += n
  }
  return out
}

export type Standing = { key: ScoreKey; label: string; color: string; score: number; away?: boolean }

export function standings(state: State, sorted = true): Standing[] {
  const rows: Standing[] =
    state.grouping === 'teams'
      ? state.teams.map((t) => ({ key: t.id, label: t.name, color: t.color, score: 0 }))
      : state.players.map((p) => ({ key: p.id, label: p.name, color: colorFor(p.id), score: 0, away: !p.connected }))
  const withScores = rows.map((r) => ({ ...r, score: state.scores[r.key] ?? 0 }))
  return sorted ? withScores.sort((a, b) => b.score - a.score) : withScores
}

export function setlistPosition(state: Pick<State, 'setlist' | 'games'>): string | null {
  const list = state.setlist
  const block = list?.blocks[list.at]
  if (!block) return null
  const position = `Block ${list.at + 1}/${list.blocks.length}`
  if (isMinigameId(block.game)) return `${MINIGAME_INFO[block.game].name} · ${position}`
  const mode = state.games.find((game) => game.id === block.game)?.name ?? block.game
  return `${mode} · ${position} · Question ${list.done + 1}/${block.count}`
}

export const playerName = (state: State, playerId: string) =>
  state.players.find((player) => player.id === playerId)?.name ?? '?'

export function colorForPlayer(state: State, playerId: string): string {
  const team = state.grouping === 'teams'
    ? state.teams.find((t) => t.id === state.players.find((p) => p.id === playerId)?.teamId)
    : undefined
  return team?.color ?? colorFor(playerId)
}

export function lockedNames(state: State): string[] {
  return state.round.lockedOut.map(
    (k) =>
      state.teams.find((t) => t.id === k)?.name ??
      state.players.find((p) => p.id === k)?.name ??
      '?',
  )
}

export function eligibleForDuel(state: State) {
  return state.players.filter((p) => p.connected && (state.grouping !== 'teams' || !!p.teamId))
}

export function willSeat(state: State): [ScoreKey, ScoreKey] | null {
  const duel = state.duel
  const rule = state.duelRules.find((r) => r.id === duel?.rule)
  if (!duel || duel.seated || rule?.resolve !== 'votes') return null

  const eligible = new Set(eligibleForDuel(state).map((p) => p.id))
  const teamOf = (id: string) => state.players.find((p) => p.id === id)?.teamId
  const ranked = duel.pool
    .filter((e) => e.votes.length > 0 && eligible.has(e.playerId))
    .sort((a, b) => b.votes.length - a.votes.length)
    .map((e) => e.playerId)

  const first = ranked[0]
  if (!first) return null
  if (state.grouping !== 'teams') return ranked[1] ? [first, ranked[1]] : null
  const second = ranked.find((id) => id !== first && teamOf(id) !== teamOf(first))
  return second ? [first, second] : null
}

export function packLabel(state: State, pack: string): string {
  const cost = state.packCost[pack]
  if (cost === undefined) return pack
  return cost ? `${pack} — ~${credits(cost)} credits` : `${pack} — paid`
}

export function credits(chars: number): string {
  return Math.round(chars * 0.55).toLocaleString()
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

export const sortHostRows = (rows: HostRow[]) =>
  [...rows].sort((a, b) => a.score === undefined || b.score === undefined
    ? Number(a.score === undefined) - Number(b.score === undefined)
    : b.score - a.score)
