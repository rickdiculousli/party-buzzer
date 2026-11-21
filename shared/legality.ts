import { isPenalty } from './protocol.ts'
import { arrivalBlocksPlay } from './arrival.ts'
import type { HostAction, State } from './protocol.ts'

export type Refusal =
  | 'not-idle'
  | 'no-leader'
  | 'already-scored'
  | 'nothing-held'
  | 'no-duel'
  | 'duel-seated'
  | 'unknown-mode'
  | 'unknown-duel-rule'
  | 'no-setlist'
  | 'no-players'
  | 'minigame-active'
  | 'unpicked'
  | 'team-too-small'
  | 'ink-cards'
  | 'too-few-players'
  | 'sketch-words'
  | 'no-choice'
  | 'no-guessing'
  | 'not-open'
  | 'arrival-changed'
  | 'introduction-active'
  | 'reading-active'
  | 'duel-active'

export function refuses(s: State, a: HostAction): Refusal | null {
  const r = s.round

  if (s.minigame && ![
    'undo', 'setScore', 'rename', 'kick', 'assign', 'addTeam',
    'prepareMinigame', 'startMinigame', 'cancelMinigame', 'closeMinigame',
  ].includes(a.a)) return 'minigame-active'

  const idle: Refusal | null = r.phase === 'IDLE' ? null : 'not-idle'

  switch (a.a) {
    case 'arm':
      return arrivalBlocksPlay(s) ? 'introduction-active' : null

    case 'correct':
    case 'wrong':
      if (r.phase !== 'LOCKED' || !r.order[0]) return 'no-leader'
      return r.award && !isPenalty(r.award) ? 'already-scored' : null

    case 'timeUp':
      return r.phase === 'ARMED' && r.kind !== 'choice' && r.kind !== 'closest' && r.order.length === 0 ? null : 'not-open'

    case 'settleChoice':
      return r.kind === 'choice' && r.choices && r.correct === undefined &&
        Number.isInteger(a.correct) && a.correct >= 0 && a.correct < r.choices.length
        ? null
        : 'no-choice'

    case 'settleClosest':
      return r.kind === 'closest' && r.guessing && r.truth === undefined && Number.isFinite(a.truth)
        ? null
        : 'no-guessing'

    case 'rebound':
      return r.held ? null : 'nothing-held'

    case 'setMode':
      if (idle) return idle
      if (s.games.length > 0 && !s.games.some((g) => g.id === a.id)) return 'unknown-mode'
      return null

    case 'openDuel':
      if (idle) return idle
      if (s.duelRules.length > 0 && !s.duelRules.some((r) => r.id === a.rule)) {
        return 'unknown-duel-rule'
      }
      return null

    case 'closeDuel':
      if (!s.duel) return 'no-duel'
      if (s.duel.seated) return 'duel-seated'
      return idle

    case 'setSetlist':
    case 'clearSetlist':
      return idle

    case 'setlistJump':
      return idle ?? (s.setlist ? null : 'no-setlist')

    case 'undo':
      return null

    case 'prepareMinigame':
      if (arrivalBlocksPlay(s)) return 'introduction-active'
      return idle ?? (s.minigame?.phase === 'playing' || s.minigame?.phase === 'countdown' ? 'not-idle' : null)

    case 'startMinigame':
      return s.players.some((player) => player.connected) ? null : 'no-players'
    case 'cancelMinigame':
    case 'closeMinigame':
      return null

    case 'openLobby':
      if (arrivalBlocksPlay(s)) return 'introduction-active'
      if (s.readingActive) return 'reading-active'
      if (s.duel) return 'duel-active'
      return idle

    case 'closeArrival':
      return s.arrival?.id === a.arrivalId ? null : 'arrival-changed'

    case 'next':
    case 'resetRound':
    case 'cancelDuel':
      return null

    case 'setValue':
    case 'setAnswerWindow':
    case 'setChoiceTime':
    case 'setRevealTime':
    case 'setScore':
    case 'rename':
    case 'kick':
    case 'setGrouping':
    case 'addTeam':
    case 'assign':
    case 'setMirror':
    case 'setAutoplay':
    case 'clearNight':
      return null
  }
}

export function clueBlockReason(s: State): Refusal | null {
  if (s.minigame) return 'minigame-active'
  if (arrivalBlocksPlay(s)) return 'introduction-active'
  if (s.readingActive) return 'reading-active'
  return null
}
