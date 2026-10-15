/**
 * What the night's ledger says, derived: the one-line milestones shown while
 * play goes on, and the cards the finale cycles. Pure, like `shared/wall.ts`:
 * facts in, words out, with no clock and no DOM, so the board, the `/recap`
 * page and the file written at the finale all read the night the same way.
 *
 * Only positive or neutral facts become cards. There is deliberately no slowest,
 * most wrong or fewest points: a recap that embarrasses a guest is not a keepsake.
 */
import type { Night, NightFact, ScoreKey, State } from './protocol.ts'

type Roster = Pick<State, 'players' | 'teams' | 'grouping' | 'scores'>
type Verdict = Extract<NightFact, { kind: 'verdict' }>
type Standings = Extract<NightFact, { kind: 'standings' }>

export type Milestone = {
  kind: 'first-correct' | 'leader' | 'streak' | 'comeback'
  text: string
  questionId?: string
  matchId?: string
}

export type RecapCard = { id: string; title: string; name: string; detail?: string }

/** Every block of the setlist has been played (the `idle:finale` condition). */
export function setlistSpent(s: Pick<State, 'setlist'>): boolean {
  const setlist = s.setlist
  return !!setlist && setlist.blocks.length > 0 && setlist.at >= setlist.blocks.length
}

/**
 * A team's name in a teams grouping, otherwise the player's. A player who has
 * left the room is still named: the facts carry the name they played under.
 */
export function labelFor(roster: Pick<Roster, 'players' | 'teams' | 'grouping'>, key: ScoreKey, night?: Night): string {
  if (roster.grouping === 'teams') {
    const team = roster.teams.find((t) => t.id === key)
    if (team) return team.name
  }
  return roster.players.find((p) => p.id === key)?.name ?? rememberedName(night, key) ?? '?'
}

const labelOf = labelFor

/** The last name the ledger saw a player under, when the key is a player's own. */
function rememberedName(night: Night | undefined, key: ScoreKey): string | undefined {
  if (!night) return undefined
  for (let i = night.facts.length - 1; i >= 0; i--) {
    const f = night.facts[i]!
    if ((f.kind === 'verdict' || f.kind === 'item') && f.playerId === key) return f.name
    if (f.kind === 'minigame') {
      const r = f.results.find((r) => r.playerId === key)
      if (r) return r.name
    }
  }
  return undefined
}

/** When the night began: its first fact, if it has one. */
export function nightStart(night: Night | undefined): number | undefined {
  return night?.facts[0]?.at
}

function ordinal(n: number): string {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

const join = (labels: string[]) => [...new Set(labels)].join(' & ')

const verdicts = (night: Night): Verdict[] =>
  night.facts.filter((f): f is Verdict => f.kind === 'verdict')

/** The key holding first place outright, or null while two share it. */
function uniqueTop(f: Standings): ScoreKey | null {
  const [a, b] = f.order
  return a && (!b || b.score !== a.score) ? a.key : null
}

type Run = { key: ScoreKey; length: number; questionId: string; at: number }

/**
 * Each key's runs of consecutive questions it got right. A question counts for
 * a key when any hit fact of it carries that key, so a question answered by
 * someone else, or by nobody, ends the run. Minigames, items and standings
 * facts sit between questions without touching a run. Returns every length a
 * run reached (one entry per step), in ledger order.
 */
function runSteps(night: Night): Run[] {
  const questions = new Map<string, { hits: Map<ScoreKey, number> }>()
  const keys = new Set<ScoreKey>()
  night.facts.forEach((f, i) => {
    if (f.kind !== 'verdict') return
    keys.add(f.key)
    let q = questions.get(f.questionId)
    if (!q) questions.set(f.questionId, (q = { hits: new Map() }))
    if (f.hit && !q.hits.has(f.key)) q.hits.set(f.key, i)
  })
  const run = new Map<ScoreKey, number>()
  const steps: Run[] = []
  for (const [questionId, q] of questions) {
    for (const key of keys) {
      const at = q.hits.get(key)
      if (at === undefined) {
        run.set(key, 0)
        continue
      }
      const length = (run.get(key) ?? 0) + 1
      run.set(key, length)
      steps.push({ key, length, questionId, at })
    }
  }
  return steps.sort((a, b) => a.at - b.at)
}

type Comeback = { key: ScoreKey; worst: number; now: number; best: number; at: number; fact: Standings }

/** Competition rank, zero-based: how many keys score strictly more. Everyone on 0 is first, nobody is last. */
const rankOf = (order: Standings['order'], i: number): number =>
  order.filter((o) => o.score > order[i]!.score).length

/**
 * A key reaching the podium from the bottom half, once per key; needs a field
 * of four or more. The podium stops short of the bottom half, so in a field of
 * four it is the top two: "3rd to 3rd" is not a climb. `now` is the rank at the
 * climb (the milestone), `best` the best rank held from then on (the card).
 */
function comebacks(night: Night): Comeback[] {
  const out: Comeback[] = []
  const worst = new Map<ScoreKey, number>()
  const done = new Set<ScoreKey>()
  night.facts.forEach((f, at) => {
    if (f.kind !== 'standings') return
    const n = f.order.length
    const podium = Math.min(3, Math.floor(n / 2))
    f.order.forEach(({ key }, i) => {
      const now = rankOf(f.order, i)
      const was = worst.get(key)
      if (n >= 4 && now < podium && was !== undefined && was >= Math.ceil(n / 2) && !done.has(key)) {
        done.add(key)
        out.push({ key, worst: was, now, best: now, at, fact: f })
      }
    })
    f.order.forEach(({ key }, i) => worst.set(key, Math.max(worst.get(key) ?? 0, rankOf(f.order, i))))
    for (const c of out) {
      const i = f.order.findIndex((o) => o.key === c.key)
      if (i >= 0) c.best = Math.min(c.best, rankOf(f.order, i))
    }
  })
  return out
}

function ranked(night: Night, roster: Roster): { at: number; m: Milestone }[] {
  const out: { at: number; m: Milestone }[] = []
  const labelFor = (r: Roster, key: ScoreKey) => labelOf(r, key, night)
  const firstHit = night.facts.findIndex((f) => f.kind === 'verdict' && f.hit)
  if (firstHit >= 0) {
    const f = night.facts[firstHit] as Verdict
    out.push({ at: firstHit, m: { kind: 'first-correct', text: `First correct: ${labelFor(roster, f.key)}`, questionId: f.questionId } })
  }
  let previous: Standings | undefined
  night.facts.forEach((f, at) => {
    if (f.kind !== 'standings') return
    const top = uniqueTop(f)
    if (previous && top !== null && top !== uniqueTop(previous)) {
      out.push({ at, m: { kind: 'leader', text: `New leader: ${labelFor(roster, top)}`, questionId: f.questionId, matchId: f.matchId } })
    }
    previous = f
  })
  for (const r of runSteps(night)) {
    if (r.length % 3 !== 0) continue
    const words = ({ 3: 'Three', 6: 'Six', 9: 'Nine' } as Record<number, string>)[r.length]
    const text = words ? `${words} in a row: ${labelFor(roster, r.key)}` : `${r.length} in a row: ${labelFor(roster, r.key)}`
    out.push({ at: r.at, m: { kind: 'streak', text, questionId: r.questionId } })
  }
  for (const c of comebacks(night)) {
    const text = `Comeback: ${labelFor(roster, c.key)}, ${ordinal(c.worst + 1)} to ${ordinal(c.now + 1)}`
    out.push({ at: c.at, m: { kind: 'comeback', text, questionId: c.fact.questionId, matchId: c.fact.matchId } })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** One-line recognitions in ledger order. */
export function milestones(night: Night, roster: Roster): Milestone[] {
  return ranked(night, roster).map((r) => r.m)
}

/**
 * The first correct answer of the night makes its scorer the first outright
 * leader in the same breath, so it outranks that; after it, a change at the top
 * beats a climb beats a run.
 */
const RANK: Record<Milestone['kind'], number> = { 'first-correct': 4, leader: 3, comeback: 2, streak: 1 }

/** The single line worth saying at this question or match, if any. */
export function milestoneFor(
  night: Night,
  roster: Roster,
  at: { questionId?: string; matchId?: string },
): string | null {
  let best: Milestone | null = null
  for (const m of milestones(night, roster)) {
    const here = (at.questionId !== undefined && m.questionId === at.questionId) ||
      (at.matchId !== undefined && m.matchId === at.matchId)
    if (here && (!best || RANK[m.kind] > RANK[best.kind])) best = m
  }
  return best?.text ?? null
}

/** The keys that currently score, best first; ties keep roster order. */
function currentOrder(roster: Roster): { key: ScoreKey; score: number }[] {
  const keys = roster.grouping === 'teams' ? roster.teams.map((t) => t.id) : roster.players.map((p) => p.id)
  return keys.map((key) => ({ key, score: roster.scores[key] ?? 0 })).sort((a, b) => b.score - a.score)
}

/** Keys with the best value under `pick` (smaller wins when `low`), at most their labels joined. */
function bestKeys<T>(items: [ScoreKey, T][], value: (t: T) => number, low: boolean): { keys: ScoreKey[]; value: number } | null {
  let best: number | null = null
  for (const [, t] of items) {
    const v = value(t)
    if (best === null || (low ? v < best : v > best)) best = v
  }
  if (best === null) return null
  return { keys: items.filter(([, t]) => value(t) === best).map(([k]) => k), value: best }
}

export function recapCards(night: Night, roster: Roster): RecapCard[] {
  const cards: RecapCard[] = []
  const label = (key: ScoreKey) => labelOf(roster, key, night)
  const names = (keys: ScoreKey[]) => join(keys.map(label))

  const timed = verdicts(night).filter((v) => v.source === 'buzz' && v.reactionMs !== undefined)
  const fastest = bestKeys(timed.map((v) => [v.key, v] as [ScoreKey, Verdict]), (v) => v.reactionMs!, true)
  if (fastest) {
    const lead = timed.find((v) => v.reactionMs === fastest.value)!
    cards.push({
      id: 'fastest',
      title: 'Fastest buzz',
      name: names(timed.filter((v) => v.reactionMs === fastest.value).map((v) => v.key)),
      detail: lead.marginMs === undefined ? `${fastest.value} ms` : `${fastest.value} ms · ${lead.marginMs} ms ahead`,
    })
  }

  const peak = new Map<ScoreKey, number>()
  for (const r of runSteps(night)) peak.set(r.key, Math.max(peak.get(r.key) ?? 0, r.length))
  const longest = bestKeys([...peak], (n) => n, false)
  if (longest && longest.value >= 2) {
    cards.push({ id: 'streak', title: 'Longest streak', name: names(longest.keys), detail: `${longest.value} in a row` })
  }

  const firstBuzz = new Map<string, ScoreKey>()
  for (const v of verdicts(night)) if (v.source === 'buzz' && !firstBuzz.has(v.questionId)) firstBuzz.set(v.questionId, v.key)
  const counts = new Map<ScoreKey, number>()
  for (const key of firstBuzz.values()) counts.set(key, (counts.get(key) ?? 0) + 1)
  const most = bestKeys([...counts], (n) => n, false)
  if (most && most.value >= 2) {
    cards.push({ id: 'first-buzzes', title: 'Most first buzzes', name: names(most.keys), detail: `first to buzz ${most.value} times` })
  }

  for (const c of comebacks(night)) {
    cards.push({ id: `comeback-${c.key}`, title: 'Comeback', name: label(c.key), detail: `${ordinal(c.worst + 1)} to ${ordinal(c.best + 1)}` })
  }

  for (const f of night.facts) {
    if (f.kind !== 'minigame' || f.results.length === 0) continue
    const teams = new Map<ScoreKey, { name: string; points: number; place?: number }>()
    for (const r of f.results) {
      const t = teams.get(r.key) ?? { name: label(r.key) === '?' ? r.name : label(r.key), points: 0 }
      t.points += r.points
      if (r.place !== undefined) t.place = Math.min(t.place ?? r.place, r.place)
      teams.set(r.key, t)
    }
    const groups = [...teams]
    const placed = groups.filter(([, t]) => t.place !== undefined)
    const winners = placed.length > 0
      ? bestKeys(placed, (t) => t.place!, true)
      : bestKeys(groups, (t) => t.points, false)
    if (!winners) continue
    const first = teams.get(winners.keys[0]!)!
    cards.push({
      id: `minigame-${f.matchId}`,
      title: f.id.charAt(0).toUpperCase() + f.id.slice(1),
      name: join(winners.keys.map((k) => teams.get(k)!.name)),
      detail: placed.length > 0 ? `${ordinal(first.place!)} place` : `${first.points} points`,
    })
  }

  // Not when nobody scored, which is also what a scoreless mode looks like.
  const order = currentOrder(roster)
  if (order.length >= 2 && order[0]!.score !== 0) {
    const [a, b] = order as [typeof order[0], typeof order[0]]
    cards.push(a.score === b.score
      ? { id: 'closest', title: 'Closest finish', name: `${label(a.key)} & ${label(b.key)}`, detail: `tied at ${a.score}` }
      : { id: 'closest', title: 'Closest finish', name: `${label(a.key)} over ${label(b.key)}`, detail: `by ${a.score - b.score} points` })
  }
  return cards
}

/** The JSON behind `nights/<date>.json` and `/recap.json`. */
export function nightKeepsake(state: State, date: string) {
  return {
    version: 1 as const,
    date,
    grouping: state.grouping,
    players: state.players.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId })),
    teams: state.teams,
    standings: currentOrder(state).map((s) => ({ key: s.key, label: labelFor(state, s.key, state.night), score: s.score })),
    cards: recapCards(state.night ?? { facts: [] }, state),
    facts: state.night?.facts ?? [],
  }
}
