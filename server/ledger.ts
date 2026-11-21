import type {
  HostAction, MinigameId, MinigameResult, NightFact, PlayerId, ScoreKey, State,
} from '../shared/protocol.ts'
import { closestOff, scoreKey } from '../shared/scoring.ts'

export type LedgerBefore = Pick<State, 'round' | 'setlist' | 'teams' | 'grouping' | 'scores' | 'night'> & {
  players: Pick<State['players'][number], 'id' | 'name' | 'teamId'>[]
}

export type Cause =
  | { action: HostAction }
  | { results: MinigameResult[]; matchId: string; id: MinigameId }
  | { item: { itemId: string; playerId: PlayerId; targetId?: PlayerId } }

type Standings = Extract<NightFact, { kind: 'standings' }>

function standingsOrder(state: Pick<State, 'players' | 'teams' | 'grouping' | 'scores'>): Standings['order'] {
  const keys: ScoreKey[] = state.grouping === 'teams' ? state.teams.map((t) => t.id) : state.players.map((p) => p.id)
  return keys.map((key) => ({ key, score: state.scores[key] ?? 0 })).sort((a, b) => b.score - a.score)
}

const heldOutright = (order: Standings['order']): boolean =>
  order.length > 0 && (order.length === 1 || order[0]!.score !== order[1]!.score)

export function nightFacts(before: LedgerBefore, after: State, cause: Cause, now: number): NightFact[] {
  const name = (id: PlayerId) => after.players.find((p) => p.id === id)?.name ?? '?'
  const block = before.setlist && before.setlist.at < before.setlist.blocks.length ? before.setlist.at : undefined
  const facts: NightFact[] = []
  const round = before.round

  if ('action' in cause) {
    const action = cause.action
    if (action.a === 'clearNight') return []
    const questionId = round.questionId
    if (action.a === 'correct' || action.a === 'wrong') {
      const leader = round.order[0]
      if (leader) {
        const hit = action.a === 'correct'
        const spent = action.a === 'wrong' ? -action.neg : round.value
        const margin = round.order[1]?.deltaMs
        facts.push({
          kind: 'verdict', at: now, questionId, block,
          playerId: leader.playerId, key: scoreKey(after, leader.playerId), name: name(leader.playerId),
          points: after.round.award?.points ?? spent,
          hit,
          ...(leader.at > round.armedAt ? { reactionMs: Math.round(leader.at - round.armedAt) } : {}),
          ...(margin === undefined ? {} : { marginMs: margin }),
          source: 'buzz',
        })
      }
    } else if (action.a === 'settleChoice') {
      for (const [playerId, pick] of Object.entries(round.picks ?? {})) {
        if (pick !== action.correct) continue
        facts.push({
          kind: 'verdict', at: now, questionId, block,
          playerId, key: scoreKey(after, playerId), name: name(playerId),
          points: round.value, hit: true, source: 'choice',
        })
      }
    } else if (action.a === 'settleClosest') {
      for (const [playerId, points] of Object.entries(after.round.paid ?? {})) {
        const guess = round.guesses?.[playerId]
        facts.push({
          kind: 'verdict', at: now, questionId, block,
          playerId, key: scoreKey(after, playerId), name: name(playerId),
          points, hit: guess !== undefined && closestOff(guess, action.truth) === after.round.nearest, source: 'closest',
        })
      }
    }
  } else if ('results' in cause) {
    facts.push({
      kind: 'minigame', at: now, id: cause.id, matchId: cause.matchId, block,
      results: cause.results.map((r) => ({
        playerId: r.playerId, key: scoreKey(after, r.playerId), name: name(r.playerId), points: r.points, place: r.place,
      })),
    })
  } else {
    const { itemId, playerId, targetId } = cause.item
    return [{
      kind: 'item', at: now, itemId, playerId, name: name(playerId),
      targetId, targetName: targetId === undefined ? undefined : name(targetId),
      questionId: after.round.questionId || undefined,
    }]
  }

  const order = standingsOrder(after)
  const last = before.night?.facts.findLast((f): f is Standings => f.kind === 'standings')
  const changed = !last || last.order.length !== order.length ||
    last.order.some((o, i) => o.key !== order[i]!.key) || heldOutright(last.order) !== heldOutright(order)
  if (order.length > 0 && changed) {
    const play = 'results' in cause ||
      ('action' in cause && (cause.action.a === 'correct' || cause.action.a === 'wrong' || cause.action.a === 'settleChoice' || cause.action.a === 'settleClosest'))
    facts.push({
      kind: 'standings', at: now, order,
      ...(!play ? {} : 'results' in cause ? { matchId: cause.matchId } : round.questionId ? { questionId: round.questionId } : {}),
    })
  }
  return facts
}
