import { isPenalty } from './protocol.ts'
import { milestoneFor, setlistSpent } from './recap.ts'
import { pickers } from './choice.ts'
import { formatNumber, lineScale, placeOn } from './closest.ts'
import { closestOff, revealHeldAt } from './scoring.ts'
import { arrivalPresentation, type ArrivalPresentation } from './arrival.ts'
import type { Award, State } from './protocol.ts'

export type Moment =
  | 'arrival:lobby'
  | 'arrival:introduction'
  | 'choice:listening'
  | 'choice:picking'
  | 'choice:reveal'
  | 'closest:listening'
  | 'closest:guessing'
  | 'closest:reveal'
  | 'answer:judging'
  | 'verdict:hold'
  | 'answer:locked'
  | 'verdict:penalty'
  | 'verdict:award'
  | 'verdict:unanswered'
  | 'duel:nominating'
  | 'duel:dead'
  | 'duel:faceoff'
  | 'buzz:collecting'
  | 'buzz:open'
  | 'buzz:arming'
  | 'idle:finale'
  | 'idle:ready'
  | 'idle:welcome'

export type Local = { open: boolean; settled: boolean; retired: boolean }

export type Family = 'arrival' | 'choice' | 'closest' | 'answer' | 'verdict' | 'duel' | 'buzz' | 'idle'
export function isFamily<F extends Family>(m: Moment, f: F): m is Extract<Moment, `${F}:${string}`> {
  return m.startsWith(`${f}:`)
}

const scorelessOf = (state: State) => !!state.games?.find((g) => g.id === state.game.id)?.scoreless

export function momentOf(state: State, local: Local): Moment {
  const r = state.round

  if (state.arrival) return state.arrival.kind === 'lobby' ? 'arrival:lobby' : 'arrival:introduction'

  if (r.kind === 'choice' && r.questionId) {
    if (r.correct !== undefined) return 'choice:reveal'
    return r.choices ? 'choice:picking' : 'choice:listening'
  }
  if (r.kind === 'closest' && r.questionId) {
    if (r.truth !== undefined) return 'closest:reveal'
    return r.guessing ? 'closest:guessing' : 'closest:listening'
  }

  if (r.spoken && !local.settled) return 'answer:judging'
  if (r.held) return 'verdict:hold'
  if (r.phase === 'LOCKED') return 'answer:locked'

  const rebounding = (r.buzzable?.length === 1 || scorelessOf(state)) && r.phase === 'ARMED'
  const handedBack = !!state.readingActive && r.phase === 'ARMED'
  if (r.award && r.phase !== 'COLLECTING' && !handedBack && (!local.retired || rebounding)) {
    return isPenalty(r.award) ? 'verdict:penalty' : 'verdict:award'
  }
  if (r.phase === 'IDLE' && r.questionId && !r.award) return 'verdict:unanswered'

  if (state.duel && !state.duel.seated) return 'duel:nominating'
  if (r.buzzable?.length === 0) return 'duel:dead'
  if (r.phase === 'COLLECTING') return 'buzz:collecting'
  if (r.buzzable?.length === 2 || state.duel?.seated) return 'duel:faceoff'

  if (r.phase === 'ARMED') return local.open ? 'buzz:open' : 'buzz:arming'

  if (setlistSpent(state)) return 'idle:finale'

  const started = r.armedAt > 0 || Object.values(state.scores).some((n) => n !== 0)
  return started ? 'idle:ready' : 'idle:welcome'
}

export type HeroTone = 'answering' | 'awarded' | 'penalised'

export type Wall = {
  moment: Moment
  hero: { name: string; tone: HeroTone } | null
  clue: { whole?: string; shown: string; image?: string } | null
  nominations: 'solo' | 'teams' | null
  faceoff: [string, string] | null
  call: 'buzz' | 'ready' | 'dead' | null
  finale: Tier[] | null
  next: number | null
  unanswered: { answer?: string } | null

  transcript: { name: string; text: string; hit: boolean } | null
  award: (Award & { answer?: string; scoreless?: true }) | null
  timeline: boolean
  value: number | null
  choices: ChoiceWall | null
  closest: ClosestWall | null
  arrival: ArrivalPresentation | null
  milestone: string | null
  reveal: RevealWall | null
}

export type RevealWall = { from: number; until: number; heldAt?: number; live: boolean; sharp: boolean; opensAt: number }

export type ChoiceWall = {
  options: string[]
  points: number
  pickers: { id: string; picked: boolean }[]
  closesAt?: number
  correct?: number
  by?: string[][]
  winners?: string[]
}

export type ClosestWall = {
  unit?: string
  plain?: true
  points: number
  guessers: { id: string; guessed: boolean }[]
  closesAt?: number
  truth?: { value: number; text: string; at: number }
  marks?: ClosestMark[]
  winners?: { name: string; paid: number; off: number }[]
}

export type ClosestMark = {
  id: string
  name: string
  guess: number
  text: string
  at: number
  parked?: 'low' | 'high'
  off: number
  paid: number
  place?: 1 | 2
}

type Middle =
  | { hero: NonNullable<Wall['hero']> }
  | { clue: NonNullable<Wall['clue']> }
  | { nominations: NonNullable<Wall['nominations']> }
  | { faceoff: NonNullable<Wall['faceoff']> }
  | { call: NonNullable<Wall['call']> }
  | { finale: NonNullable<Wall['finale']> }
  | { next: number }

const EMPTY_MIDDLE = {
  hero: null,
  clue: null,
  nominations: null,
  faceoff: null,
  call: null,
  finale: null,
  next: null,
} satisfies Pick<Wall, 'hero' | 'clue' | 'nominations' | 'faceoff' | 'call' | 'finale' | 'next'>

export type Tier = { place: 1 | 2 | 3; names: string[]; score: number }

export function finaleTiers(state: Pick<State, 'grouping' | 'players' | 'teams' | 'scores'>): Tier[] {
  const rows =
    state.grouping === 'teams'
      ? state.teams.map((t) => ({ name: t.name, score: state.scores[t.id] ?? 0 }))
      : state.players.map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0 }))
  const scores = [...new Set(rows.map((r) => r.score))].sort((a, b) => b - a)
  const tiers: Tier[] = []
  for (const score of scores) {
    const place = 1 + rows.filter((r) => r.score > score).length
    if (place > 3) break
    tiers.push({ place: place as Tier['place'], names: rows.filter((r) => r.score === score).map((r) => r.name), score })
  }
  return tiers
}

export const FINALE_SCHEDULE = { build: 2400, third: 2600, second: 2600 }

export type FinaleStep = 'build' | 3 | 2 | 1

export function finaleStep(tiers: readonly { place: number }[], elapsedMs: number): { step: FinaleStep; until: number } {
  const has = (place: number) => tiers.some((t) => t.place === place)
  let until = FINALE_SCHEDULE.build
  if (elapsedMs < until) return { step: 'build', until }
  if (has(3)) {
    until += FINALE_SCHEDULE.third
    if (elapsedMs < until) return { step: 3, until }
  }
  if (has(2)) {
    until += FINALE_SCHEDULE.second
    if (elapsedMs < until) return { step: 2, until }
  }
  return { step: 1, until: Infinity }
}

export function finaleCalled(step: FinaleStep, place: number): boolean {
  if (step === 'build') return false
  return place <= 3 ? step <= place : step === 1
}

function middleOf(state: State, m: Moment): Middle {
  const r = state.round
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  const hero = (name?: string, tone: HeroTone = 'answering') =>
    name ? ({ hero: { name, tone } } satisfies Middle) : null

  const or = (...xs: (Middle | null | undefined)[]): Middle =>
    xs.find((x) => x != null) ?? { call: 'ready' }

  const clue: Middle | null =
    state.readingActive || r.fragments?.length
      ? { clue: { whole: r.whole, shown: r.fragments?.join(' ') ?? '', ...(r.image && { image: r.image }) } }
      : state.typed ? { clue: { shown: state.typed } } : null

  const seated = state.duel?.seated ?? r.buzzable
  const pair: Middle | null =
    seated?.length === 2 ? { faceoff: [nameOf(seated[0]), nameOf(seated[1])] } : null

  const leader = hero(r.order[0]?.name)
  const spoken = hero(r.spoken?.name)
  const scorer = hero(r.award?.name, isPenalty(r.award) ? 'penalised' : 'awarded')

  switch (m) {
    case 'arrival:lobby':
    case 'arrival:introduction':
      return { call: 'ready' }
    case 'choice:listening':
    case 'choice:picking':
    case 'choice:reveal':
    case 'closest:listening':
    case 'closest:guessing':
    case 'closest:reveal':
      return or(clue)
    case 'answer:judging':
      return or(spoken, leader, clue)
    case 'verdict:hold':
    case 'verdict:penalty':
      return or(scorer, clue)
    case 'verdict:award':
      return or(scorer, clue)
    case 'verdict:unanswered':
      return or(clue)
    case 'answer:locked':
    case 'buzz:collecting':
      return or(leader, clue, pair, { call: 'buzz' })
    case 'duel:nominating':
      return { nominations: state.grouping === 'teams' ? 'teams' : 'solo' }
    case 'duel:dead':
      return { call: 'dead' }
    case 'duel:faceoff':
      return or(clue, pair)
    case 'buzz:open':
      return or(clue, { call: 'buzz' })
    case 'buzz:arming':
      return or(clue, isPenalty(r.award) ? scorer : null, { next: r.value })
    case 'idle:finale': {
      const tiers = finaleTiers(state)
      return tiers.length ? { finale: tiers } : { call: 'ready' }
    }
    case 'idle:ready':
      return or(r.fragments?.length || state.typed ? clue : null, { next: r.value })
    case 'idle:welcome':
      return or(clue, { call: 'ready' })
  }
}

export function lastUp(state: State): boolean {
  const s = state.setlist
  return !!s && s.at === s.blocks.length - 1 && s.done === s.blocks[s.at].count - 1
}

function choiceWall(state: State, m: Moment): ChoiceWall | null {
  const r = state.round
  if (!isFamily(m, 'choice') || !r.choices) return null
  const picks = Object.entries(r.picks ?? {})
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  return {
    options: r.choices,
    points: r.value,
    pickers: [
      ...picks.map(([id]) => ({ id, picked: true })),
      ...pickers(state).filter((id) => r.picks?.[id] === undefined).map((id) => ({ id, picked: false })),
    ],
    closesAt: r.closesAt,
    ...(r.correct !== undefined && {
      correct: r.correct,
      by: r.choices.map((_, i) => picks.filter(([, p]) => p === i).map(([id]) => id)),
      winners: picks.filter(([, p]) => p === r.correct).map(([id]) => nameOf(id)),
    }),
  }
}

function revealWall(state: State): RevealWall | null {
  const r = state.round
  if (!r.reveal) return null
  const heldAt = revealHeldAt(r)
  return {
    from: r.reveal.from,
    until: r.reveal.until,
    ...(heldAt !== undefined && { heldAt }),
    live: r.phase === 'ARMED',
    sharp: r.phase === 'IDLE',
    opensAt: r.armedAt,
  }
}

function closestWall(state: State, m: Moment): ClosestWall | null {
  const r = state.round
  if (!isFamily(m, 'closest') || !r.guessing) return null
  const guesses = Object.entries(r.guesses ?? {})
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  const wall: ClosestWall = {
    ...(r.guessing.unit && { unit: r.guessing.unit }),
    ...(r.guessing.plain && { plain: true as const }),
    points: r.value,
    guessers: [
      ...guesses.map(([id]) => ({ id, guessed: true })),
      ...pickers(state).filter((id) => r.guesses?.[id] === undefined).map((id) => ({ id, guessed: false })),
    ],
    closesAt: r.guessing.closesAt,
  }
  if (r.truth === undefined) return wall
  const truth = r.truth
  const scale = lineScale(guesses.map(([, g]) => g), truth)
  const paid = r.paid ?? {}
  const offOf = (g: number) => closestOff(g, truth)
  const nearest = Math.min(...guesses.map(([, g]) => offOf(g)))
  const marks: ClosestMark[] = guesses
    .map(([id, guess]) => {
      const off = offOf(guess)
      const points = paid[id] ?? 0
      return {
        id,
        name: nameOf(id),
        guess,
        text: formatNumber(guess, wall.plain),
        ...placeOn(scale, guess),
        off,
        paid: points,
        ...(points > 0 && { place: off === nearest ? (1 as const) : (2 as const) }),
      }
    })
    .sort((a, b) => a.guess - b.guess)
  return {
    ...wall,
    truth: { value: truth, text: formatNumber(truth, wall.plain), at: placeOn(scale, truth).at },
    marks,
    winners: marks.filter((k) => k.place === 1).map((k) => ({ name: k.name, paid: k.paid, off: k.off })),
  }
}

export function wallOf(state: State, local: Local): Wall {
  const r = state.round
  const m = momentOf(state, local)

  if (isFamily(m, 'arrival')) {
    return {
      moment: m,
      ...EMPTY_MIDDLE,
      unanswered: null,
      transcript: null,
      award: null,
      timeline: false,
      value: null,
      choices: null,
      closest: null,
      arrival: arrivalPresentation(state),
      milestone: null,
      reveal: null,
    }
  }

  const showAward = !!r.award && (m === 'verdict:award' || m === 'verdict:penalty' || m === 'verdict:hold')

  const leader = m === 'answer:locked' || m === 'buzz:collecting' ? r.order[0] : undefined

  const scoreless = scorelessOf(state)
  const full = middleOf(state, m)
  const middle = scoreless && ('call' in full || 'next' in full) ? {} : full

  return {
    moment: m,
    ...EMPTY_MIDDLE,
    ...middle,
    transcript: r.spoken
      ? { name: r.spoken.name, text: r.spoken.transcript, hit: r.spoken.hit }
      : null,
    award:
      showAward && r.award ? { ...r.award, answer: r.answer, ...(scoreless && { scoreless: true as const }) } : null,
    unanswered: m === 'verdict:unanswered' ? { answer: r.answer } : null,
    timeline: !!leader && r.order.length > 1,
    value: 'next' in middle || scoreless ? null : r.phase !== 'IDLE' || isFamily(m, 'answer') || isFamily(m, 'verdict') || isFamily(m, 'choice') || isFamily(m, 'closest') ? r.value : null,
    choices: choiceWall(state, m),
    closest: closestWall(state, m),
    reveal: revealWall(state),
    arrival: null,
    milestone:
      state.night && m !== 'idle:finale'
        ? milestoneFor(state.night, state, {
            questionId: r.questionId || undefined,
            matchId: state.minigame?.phase === 'results' ? state.minigame.matchId : undefined,
          })
        : null,
  }
}

export type Mood = 'waiting' | 'open' | 'placed' | 'first' | 'barred' | 'verdict'
export type Phone = { label: string; sub: string; mood: Mood; talk: boolean; tone?: Exclude<HeroTone, 'answering'>; react: boolean }
export type Mine = {
  frozen: boolean
  barred: boolean
  locked?: boolean
  scored?: boolean
  spectator: boolean
  dead: boolean
  buzzableNames?: string[]
  won: boolean
  deltaMs?: number
  pressed: boolean
  armed: boolean
  open: boolean
  judging: boolean
  place?: number
  called?: boolean
  next?: number
  last?: boolean
  pick?: number
  choices?: string[]
  correct?: number
  guess?: number
  unit?: string
  plain?: boolean
  truth?: number
  paid?: number
  closed?: boolean
  nearest?: number
  value?: number
  awardPoints?: number
  told?: Award
}

export function phoneOf(m: Moment, f: Mine): Phone {
  const react = !isFamily(m, 'arrival') && ((!!f.locked && !f.won) || !!f.scored)
  return { ...card(m, f), react }
}

function card(m: Moment, f: Mine): Omit<Phone, 'react'> {
  if (m === 'arrival:lobby') {
    return { label: 'Test buzzer', sub: 'Practice only · no points', mood: 'waiting', talk: false }
  }
  if (m === 'arrival:introduction') {
    return { label: 'Wait', sub: 'Waiting for the host', mood: 'waiting', talk: false }
  }
  if (m === 'idle:finale') {
    if (!f.called) return { label: 'Final', sub: 'Watch the board', mood: 'waiting', talk: false }
    return f.place === 1
      ? { label: 'Winner', sub: 'Top of the standings', mood: 'first', talk: false }
      : { label: 'Final', sub: f.place ? `${ordinal(f.place)} place` : '', mood: 'waiting', talk: false }
  }
  if (f.told && !isPenalty(f.told) && !f.won && (m === 'verdict:award' || m === 'idle:ready')) {
    return verdict(f.told)
  }
  if (f.frozen) {
    return {
      label: 'Frozen',
      sub: 'A freeze item shut you out of this question',
      mood: 'barred',
      talk: false,
    }
  }
  if (f.barred) {
    return {
      label: 'Out',
      sub: 'Wrong answer — you sit out the rest of this question',
      mood: 'barred',
      talk: false,
    }
  }
  if (f.dead) {
    return { label: 'Duel', sub: 'Both missed — waiting for the host', mood: 'barred', talk: false }
  }
  if (f.spectator) {
    return {
      label: 'Duel',
      sub: `${f.buzzableNames?.join(' vs ')} — you sit this one out`,
      mood: 'barred',
      talk: false,
    }
  }
  if (isPenalty(f.told) && m === 'verdict:hold') {
    return verdict(f.told!)
  }
  if (m === 'verdict:unanswered') {
    return { label: 'Nobody', sub: 'The answer is on the board', mood: 'waiting', talk: false }
  }
  if (m === 'choice:listening') {
    return { label: 'Listen', sub: 'The choices come after the question', mood: 'waiting', talk: false }
  }
  if (m === 'choice:picking') {
    return f.pick === undefined
      ? { label: 'Pick', sub: '', mood: 'open', talk: false }
      : { label: 'Locked', sub: f.choices?.[f.pick] ?? '', mood: 'placed', talk: false }
  }
  if (m === 'choice:reveal') {
    if (f.pick !== undefined && f.pick === f.correct) {
      return { label: 'Right', sub: `+${f.value ?? 0}`, mood: 'first', talk: false }
    }
    const answer = f.correct === undefined ? '' : f.choices?.[f.correct] ?? ''
    return { label: f.pick === undefined ? 'No pick' : 'Wrong', sub: `It was ${answer}`, mood: 'barred', talk: false }
  }
  if (m === 'closest:listening') {
    return { label: 'Listen', sub: 'Guess once the question is read', mood: 'waiting', talk: false }
  }
  if (m === 'closest:guessing') {
    if (f.guess !== undefined) return { label: 'Locked', sub: withUnit(f.guess, f.unit, f.plain), mood: 'placed', talk: false }
    return f.closed
      ? { label: 'Time’s up', sub: 'Watch the board', mood: 'waiting', talk: false }
      : { label: 'Guess', sub: '', mood: 'open', talk: false }
  }
  if (m === 'closest:reveal') {
    const truth = f.truth === undefined ? '' : withUnit(f.truth, f.unit, f.plain)
    if (f.guess === undefined) return { label: 'No guess', sub: `It was ${truth}`, mood: 'barred', talk: false }
    const off = closestOff(f.guess, f.truth ?? f.guess)
    if (f.paid) {
      const sub = `+${f.paid} · ${off === 0 ? 'spot on' : `${formatNumber(off, f.plain)} off`}`
      if (off === f.nearest) return { label: off === 0 ? 'Exact' : 'Nearest', sub, mood: 'first', talk: false }
      return { label: 'Second', sub, mood: 'placed', talk: false }
    }
    return { label: `${formatNumber(off, f.plain)} off`, sub: `It was ${truth}`, mood: 'barred', talk: false }
  }
  if ((m === 'verdict:award' || m === 'idle:ready') && f.won && f.awardPoints !== undefined) {
    return { label: 'Right', sub: `+${f.awardPoints}`, mood: 'first', talk: false }
  }
  const shut = !f.armed && (isFamily(m, 'answer') || m === 'verdict:hold')

  if (f.won && shut) return { label: 'You’re up', sub: 'Answer it', mood: 'first', talk: f.judging }
  if (f.pressed && f.armed) {
    return { label: 'In', sub: 'Counting the rest of the field', mood: 'placed', talk: false }
  }
  if (shut) {
    return {
      label: 'Locked',
      sub:
        m === 'verdict:hold'
          ? 'Reopening in a moment'
          : f.deltaMs !== undefined
            ? `+${f.deltaMs} ms`
            : isFamily(m, 'answer')
              ? 'Someone else is answering'
              : '',
      mood: 'barred',
      talk: false,
    }
  }
  if (f.open) return { label: 'Buzz', sub: '', mood: 'open', talk: false }
  if (f.armed) return { label: 'Wait', sub: 'Any moment', mood: 'waiting', talk: false }
  if (m === 'idle:ready' && f.next !== undefined) {
    return { label: 'Wait', sub: `${f.last ? 'Last' : 'Next'} question · ${f.next} points`, mood: 'waiting', talk: false }
  }
  return { label: 'Wait', sub: 'The host has not armed yet', mood: 'waiting', talk: false }
}

function verdict(a: Award): Omit<Phone, 'react'> {
  const miss = isPenalty(a)
  const points = a.points === 0 ? '' : `${a.points > 0 ? '+' : '−'}${Math.abs(a.points)} · `
  return {
    label: a.name,
    sub: points + (miss ? 'wrong, rebound opening' : 'right'),
    mood: 'verdict',
    talk: false,
    tone: miss ? 'penalised' : 'awarded',
  }
}

const withUnit = (n: number, unit?: string, plain?: boolean) => (unit ? `${formatNumber(n, plain)} ${unit}` : formatNumber(n, plain))

const ordinal = (n: number) => {
  const t = n % 100
  return `${n}${t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
}
