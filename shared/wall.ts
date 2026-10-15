/**
 * Where a question is, and what each surface may show while it is there.
 *
 * A surface deciding what to show from overlapping booleans has 2^n
 * combinations, of which about a dozen mean anything and nothing says which
 * dozen — so the ones nobody was thinking about are where the display bugs
 * live. This names the dozen instead.
 *
 * `momentOf` is universal. `viewFor` redacts `order`, `whole`, and (without the
 * mirror) `fragments` and `answer` — but keeps `phase`, `armedAt`, `spoken`,
 * `award`, `held`, `duel` and `buzzable`, which is every field a moment is
 * derived from. So the wall and the phones compute the same word from different
 * data and cannot drift. Nothing here may read `order`, for exactly that reason:
 * a player sees only their own entry, so a moment derived from it would differ
 * per phone. Names are what cannot be shared, which is why `Wall` carries them
 * and `Moment` does not.
 *
 * Two rules:
 *
 * 1. Content and identity, never appearance. A tone is `penalised`, not `red`;
 *    the stylesheet maps it. If this file learns what brass is, the boundary has
 *    drifted.
 * 2. It never reads the clock and never reads the DOM. Everything time-dependent
 *    arrives in `Local`. That is what keeps it runnable under `node:test`.
 */
import { isPenalty } from './protocol.ts'
import { milestoneFor, setlistSpent } from './recap.ts'
import { pickers } from './choice.ts'
import { formatNumber, lineScale, placeOn } from './closest.ts'
import { closestOff, revealHeldAt } from './scoring.ts'
import { arrivalPresentation, type ArrivalPresentation } from './arrival.ts'
import type { Award, State } from './protocol.ts'

/**
 * The twenty-three states, in priority order — `momentOf` returns the first that
 * matches, and that ordering is the load-bearing part. The two `arrival`
 * states come first because an arrival covers whatever the idle round still
 * holds, a prior payoff or choice reveal included. The three `choice` and three
 * `closest` states come next because those questions never reach any of the others.
 *
 * Reordering within a family is safe. Reordering across one is a behaviour
 * change. Two pairs are ordered the way they are for a reason that is not
 * obvious:
 *
 * - `verdict:hold` above `answer:locked`, because a hold keeps the phase at
 *   LOCKED. The other way round, a hold could never be reached at all.
 * - `answer:judging` above everything, because a spoken miss publishes the
 *   transcript, the award and `held` in one broadcast, and the room has to read
 *   the transcript before it reads the result.
 */
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

/**
 * What the surfaces know that `State` does not.
 *
 * All three are clocks the client owns: `open` is the countdown to `armedAt`,
 * `settled` is the transcript having finished typing and held `--verdict-hold`,
 * `retired` is the penalty dwell elapsing. They are inputs rather than terms in
 * six expressions, which is the whole trick — it leaves this file pure.
 */
export type Local = { open: boolean; settled: boolean; retired: boolean }

export type Family = 'arrival' | 'choice' | 'closest' | 'answer' | 'verdict' | 'duel' | 'buzz' | 'idle'
/** Typed prefix matching, so a family question stays one line and stays checked. */
export function isFamily<F extends Family>(m: Moment, f: F): m is Extract<Moment, `${F}:${string}`> {
  return m.startsWith(`${f}:`)
}

/** The mode keeps no score: the wall shows who buzzed and nothing else. */
// `?.`: recorded trace frames predate the catalog and carry no `games`.
const scorelessOf = (state: State) => !!state.games?.find((g) => g.id === state.game.id)?.scoreless

export function momentOf(state: State, local: Local): Moment {
  const r = state.round

  // `arrival` reaches every role unredacted, so the phones agree with the wall.
  if (state.arrival) return state.arrival.kind === 'lobby' ? 'arrival:lobby' : 'arrival:introduction'

  // The whole room answers a choice question at once: there is no leader, no
  // transcript and no verdict, so none of the moments below apply to it.
  if (r.kind === 'choice' && r.questionId) {
    if (r.correct !== undefined) return 'choice:reveal'
    return r.choices ? 'choice:picking' : 'choice:listening'
  }
  // The same for a closest question: the room types a number, nobody buzzes.
  if (r.kind === 'closest' && r.questionId) {
    if (r.truth !== undefined) return 'closest:reveal'
    return r.guessing ? 'closest:guessing' : 'closest:listening'
  }

  // The room reads what was said before it reads how it scored — even though
  // the server has already scored it and said so in the same broadcast.
  if (r.spoken && !local.settled) return 'answer:judging'
  // Buzzers shut while a miss stands. Above LOCKED because it *is* LOCKED.
  if (r.held) return 'verdict:hold'
  if (r.phase === 'LOCKED') return 'answer:locked'

  // A result outranks the next nomination window: a penalty rides the rebound
  // it caused, so the phase is already ARMED again underneath this.
  //
  // A duel's rebound is the one place a verdict outlives its dwell. The
  // buzzers are open again but only to one player, and the room has to keep
  // reading why for as long as that is true — a dwell that expires mid-rebound
  // drops the wall to a bare "Ready" while the question is still live, which
  // is the miss disappearing before it has been answered for. It comes down
  // when the other seated player buzzes, not on a timer: `ARMED` is what says
  // nobody has yet, and it is public, so the phones agree.
  //
  // Whoever buzzes next ends it, dwell or no dwell. A rebound taken inside the
  // penalty's 2.2s left the stamp on the wall while the board played the
  // buzz-in — the sound of someone taking the question, over a picture still
  // showing the last person missing it, and the new leader's name arriving up
  // to a second later when the round locked. COLLECTING is the phase that says
  // the room has answered, and it is public, so the phones agree.
  //
  // A scoreless mode holds every miss the same way: the name is all the wall
  // has to say, so it stays until someone buzzes or the question is reset.
  const rebounding = (r.buzzable?.length === 1 || scorelessOf(state)) && r.phase === 'ARMED'
  // While the box is driving, the question resuming is what ends the beat, and
  // it outranks both the dwell and the rebound above. The two clocks are not
  // comparable: the board retires a penalty `--penalty-dwell` after the
  // transcript has finished typing, and the reader opens the rebound
  // `autoplay.reboundSec` after the verdict and starts speaking in the same
  // instant. Nothing relates them, so the voice reached the next clause under a
  // stamp still on the wall and a stage with no clue on it. `state.ts`'s
  // `rebound` already promises the wall goes back to the clue there; this is
  // the wall keeping it. A room with no box has no voice to hand back to and
  // keeps the dwell, which is the only clock it has.
  const handedBack = !!state.readingActive && r.phase === 'ARMED'
  if (r.award && r.phase !== 'COLLECTING' && !handedBack && (!local.retired || rebounding)) {
    return isPenalty(r.award) ? 'verdict:penalty' : 'verdict:award'
  }
  // Shut with the question still up and nothing scored: the only way there is
  // `timeUp`, since every verdict stamps an award and `next` drops the question.
  if (r.phase === 'IDLE' && r.questionId && !r.award) return 'verdict:unanswered'

  if (state.duel && !state.duel.seated) return 'duel:nominating'
  // `[]`, not absent: both seated players missed, and nobody at all may buzz.
  if (r.buzzable?.length === 0) return 'duel:dead'
  // A press outranks the pair, because the pair is who *may* answer and this is
  // who *is*. Under the face-off the wall sat on "Ada vs Bo" for the whole
  // collection window while the board had already sounded the buzz-in — a
  // second of hearing someone take the question and watching the stage still
  // offer it to both of them.
  //
  // Only the moment moves. `middleOf` shows the face-off from `seated` rather
  // than from the moment, so the pair still holds the stage through the 150ms
  // before the order is published, and the name replaces it the instant there
  // is one.
  if (r.phase === 'COLLECTING') return 'buzz:collecting'
  if (r.buzzable?.length === 2 || state.duel?.seated) return 'duel:faceoff'

  if (r.phase === 'ARMED') return local.open ? 'buzz:open' : 'buzz:arming'

  // Welcome is not "the round is idle" — that is also true between every pair
  // of questions, and the bed swelling back up each time the host reaches for
  // the next card would be unbearable by round three. It ends at the first arm,
  // for good. Keyed on `armedAt` rather than on the buzz count because the
  // count is redacted and a non-buzzing phone would disagree with the wall.
  // Every block of the setlist has been played. Below every verdict, so the
  // last payoff is still read first; it lasts until the host clears or loads
  // another setlist.
  if (setlistSpent(state)) return 'idle:finale'

  const started = r.armedAt > 0 || Object.values(state.scores).some((n) => n !== 0)
  return started ? 'idle:ready' : 'idle:welcome'
}

/**
 * What is on the big screen.
 *
 * The invariant, and the point of the whole file: exactly one of `hero`,
 * `clue`, `nominations`, `faceoff`, `call`, `finale` and `next` is non-null —
 * except under a scoreless mode, which drops `call` and `next` and leaves the
 * stage blank rather than saying "Buzz" or what the next question is worth. Those seven are the
 * middle band's occupants, and the seven-branch ternary they replace existed
 * only because nothing ever said they were mutually exclusive.
 *
 * The other five are the bands above and below, and may co-occur with the
 * middle one — a miss is legitimately transcript, award and hero at once.
 */
/** The hero's verdict-so-far: `answering` is open, `awarded` paid, `penalised` cost. */
export type HeroTone = 'answering' | 'awarded' | 'penalised'

export type Wall = {
  moment: Moment
  hero: { name: string; tone: HeroTone } | null
  clue: { whole?: string; shown: string; image?: string } | null
  nominations: 'solo' | 'teams' | null
  faceoff: [string, string] | null
  call: 'buzz' | 'ready' | 'dead' | null
  /** Everyone tied for the top when the setlist is spent. */
  finale: string[] | null
  /** Between questions: what the next one is worth. */
  next: number | null
  /** Nobody took the question; the answer they missed, when the pack has one. */
  unanswered: { answer?: string } | null

  transcript: { name: string; text: string; hit: boolean } | null
  /** `scoreless`: the stamp is the verdict alone, since the points are always 0. */
  award: (Award & { answer?: string; scoreless?: true }) | null
  timeline: boolean
  value: number | null
  /**
   * A choice question's grid, in the band below the clue. Null outside
   * `choice:picking` and `choice:reveal`. Built from `picks`, which only the
   * host and board receive; phones never call `wallOf`.
   */
  choices: ChoiceWall | null
  /**
   * A closest question's line, in the band below the clue. Null outside
   * `closest:guessing` and `closest:reveal`. Built from `guesses`, which only
   * the host and board receive.
   */
  closest: ClosestWall | null
  /**
   * The lobby or introduction, during the `arrival` moments only. It replaces
   * every other band: the seven occupants and the ancillary lanes are null,
   * `timeline` is false and `value` is null. Phones read the same object from
   * `arrivalPresentation`, never from here.
   */
  arrival: ArrivalPresentation | null
  /**
   * One dim line for the question or match just settled ("New leader: Dee"),
   * from the night's ledger. Null without a night (a phone's state), under an
   * arrival and at the finale, where the recap cards take over.
   */
  milestone: string | null
  /**
   * A picture reveal's clock, for the board's mosaic and the stakes it offers,
   * whenever the round has one. Facts only: the board reads its own clock
   * against them (`revealValue`, `revealProgress`).
   */
  reveal: RevealWall | null
}

/**
 * `heldAt`: a leader's press or a miss holds the picture there. `live`: the
 * buzzers are open, so it sharpens on the clock. `sharp`: the question is over.
 * None of the three is the moment between a first press and the order being
 * published, where the board simply holds what it has. `opensAt` is the arm
 * instant: until the buzzers open the picture does not move.
 */
export type RevealWall = { from: number; until: number; heldAt?: number; live: boolean; sharp: boolean; opensAt: number }

export type ChoiceWall = {
  options: string[]
  points: number
  /**
   * Everyone who may pick, in the order they picked, then those still out.
   * Never which option: the board is in front of the room.
   */
  pickers: { id: string; picked: boolean }[]
  closesAt?: number
  correct?: number
  /** At the reveal: who picked each option, by player id. */
  by?: string[][]
  winners?: string[]
}

export type ClosestWall = {
  unit?: string
  /** Numbers without a thousands comma: the pack wrote a year. */
  plain?: true
  points: number
  /**
   * Everyone who may guess, in the order they did, then those still out.
   * Never the number: the board is in front of the room, and a number up
   * early is one the next phone copies.
   */
  guessers: { id: string; guessed: boolean }[]
  closesAt?: number
  /** At the reveal: the pack's number, spelt for the wall, and where it sits along the line, 0 to 1. */
  truth?: { value: number; text: string; at: number }
  /** At the reveal: every guess, low to high. `parked` is off the line, held at that end. */
  marks?: ClosestMark[]
  /** At the reveal: who took the value (ties share it), for the stamp. Empty when nobody guessed. */
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
  /** 1 took the value, 2 took half; absent paid nothing. */
  place?: 1 | 2
}

/**
 * The middle band's one occupant, as a one-key object.
 *
 * The type is the invariant: a `Middle` cannot name two occupants, so
 * "exactly one of seven" is enforced by the compiler rather than asserted in a
 * comment and hoped for. Four `let`s initialised to null and assigned in a
 * branch said the same thing and guaranteed none of it.
 */
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

/**
 * The middle band's occupant: one row per moment, in preference order.
 *
 * There is one ladder and it is `momentOf`; this is a lookup against it. A row
 * says what its moment would like to show and what it settles for when the
 * first choice has no data — never what outranks what, because the moment has
 * already answered that. Ranking the five occupants here as well, out of raw
 * state, is what produces a face-off outliving its buzz-in or a payoff handing
 * the stage back to the pair: two rankings that disagree, with neither wrong.
 *
 * The `switch` is exhaustive with no `default`, so a new `Moment` does not
 * compile until it has a row, and `or` returns exactly one occupant by
 * construction.
 */
/** Everyone tied for the top of the standings, by the name the room knows. */
function leaders(state: State): string[] {
  const rows =
    state.grouping === 'teams'
      ? state.teams.map((t) => ({ name: t.name, score: state.scores[t.id] ?? 0 }))
      : state.players.map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0 }))
  const best = Math.max(...rows.map((r) => r.score))
  return rows.filter((r) => r.score === best).map((r) => r.name)
}

function middleOf(state: State, m: Moment): Middle {
  const r = state.round
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  const hero = (name?: string, tone: HeroTone = 'answering') =>
    name ? ({ hero: { name, tone } } satisfies Middle) : null

  // The first choice that has anything to show. The fall-through is `ready`
  // because a stage with nothing on it is a stage waiting for the host.
  const or = (...xs: (Middle | null | undefined)[]): Middle =>
    xs.find((x) => x != null) ?? { call: 'ready' }

  // The question, while there is one on the stage: the box is mid-read, or what
  // it has read so far is still up. Empty at the arm, filling as the voice
  // reaches each clause.
  const clue: Middle | null =
    state.readingActive || r.fragments?.length
      ? { clue: { whole: r.whole, shown: r.fragments?.join(' ') ?? '', ...(r.image && { image: r.image }) } }
      : null

  // The duel's pair, not who may buzz right now — a rebound narrows `buzzable`
  // to one, and who is on the stage does not change when one of them misses.
  const seated = state.duel?.seated ?? r.buzzable
  const pair: Middle | null =
    seated?.length === 2 ? { faceoff: [nameOf(seated[0]), nameOf(seated[1])] } : null

  // `wallOf` is the board's, so `order` is whole here. `momentOf` may not read
  // it; this may, because a name is exactly what a moment cannot carry.
  const leader = hero(r.order[0]?.name)
  const spoken = hero(r.spoken?.name)
  const scorer = hero(r.award?.name, isPenalty(r.award) ? 'penalised' : 'awarded')

  switch (m) {
    // `wallOf` answers these itself, with no middle occupant at all.
    case 'arrival:lobby':
    case 'arrival:introduction':
      return { call: 'ready' }
    // The question holds the middle through the reveal; the grid below is the answer.
    case 'choice:listening':
    case 'choice:picking':
    case 'choice:reveal':
    case 'closest:listening':
    case 'closest:guessing':
    case 'closest:reveal':
      return or(clue)
    // The verdict clears `order` the instant it lands, but the room is still
    // reading the transcript above. Without this the stage flicks back to the
    // clue and is taken away again when the stamp arrives — the question
    // appearing to resume under an answer nobody has been told the result of.
    case 'answer:judging':
      return or(spoken, leader, clue)
    // A miss takes the middle outright, clue or no clue: it leaves the question
    // live and the room has to be told why, against the name it cost.
    case 'verdict:hold':
    case 'verdict:penalty':
      return or(scorer, clue)
    // A payoff takes the middle. The question behind it is spent — a correct
    // answer ends it, and nothing more will be read from that clue — so the
    // name that won is what the room spends the payoff's dwell looking at.
    // Only the box ever puts a clue up to lose the stage; under a host reading
    // aloud there are no fragments and this is the name either way.
    case 'verdict:award':
      return or(scorer, clue)
    case 'verdict:unanswered':
      return or(clue)
    case 'answer:locked':
    case 'buzz:collecting':
      // The pair is who *may* answer; the leader is who *is*. Before the order
      // is published — the hub holds it 150ms — the pair still holds the stage,
      // so a duel's buzz-in replaces it rather than blanking it first. The
      // buzzers are still taking presses until then, so it still says so.
      return or(leader, clue, pair, { call: 'buzz' })
    case 'duel:nominating':
      return { nominations: state.grouping === 'teams' ? 'teams' : 'solo' }
    case 'duel:dead':
      return { call: 'dead' }
    case 'duel:faceoff':
      return or(clue, pair)
    case 'buzz:open':
      return or(clue, { call: 'buzz' })
    // The ~300ms before the buzzers open is too short to read, so it holds
    // whatever came before: the miss on a rebound, the card on a fresh arm.
    case 'buzz:arming':
      return or(clue, isPenalty(r.award) ? scorer : null, { next: r.value })
    case 'idle:finale': {
      const top = leaders(state)
      return top.length ? { finale: top } : { call: 'ready' }
    }
    // Between questions the stage says what is coming and what it is worth.
    // An active reader alone puts an empty clue up, and that would hide the
    // card for the whole beat before the arm; only words already said keep
    // the clue. Welcome has nothing lined up yet, so it keeps "Ready".
    case 'idle:ready':
      return or(r.fragments?.length ? clue : null, { next: r.value })
    case 'idle:welcome':
      return or(clue, { call: 'ready' })
  }
}

/** The question coming up, or being asked, is the setlist's last. */
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
    // `picks` keeps insertion order, which is the order the room picked in.
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
    // `guesses` keeps insertion order, which is the order the room guessed in.
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
  // By distance, not by points: a three-way tie for the value can pay each
  // less than second place's half.
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

  // Nothing from the round shows through an arrival: not the last transcript,
  // award, answer or choices a fresh setlist left in an idle round.
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

  // A payoff stays until the next arm; a penalty is a beat, and the room goes
  // back to the question after it. A held rebound overrides that dwell, because
  // the server is showing the miss until it opens the buzzers and the board
  // must not go dark in between.
  const showAward = !!r.award && (m === 'verdict:award' || m === 'verdict:penalty' || m === 'verdict:hold')

  // The lower band's question, not the middle's: whose timeline, whose warm-up
  // bar. `middleOf` owns who is on the stage.
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
    // The stakes, as a dim chip in the corner, from the arm until the next
    // question's card replaces them: through the read, the buzz, the answer
    // and the verdict. Between questions the card says it instead.
    // Not beside the card, which says the same number large.
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

/** What is on one phone. Everything here is that player's own. */
export type Mood = 'waiting' | 'open' | 'placed' | 'first' | 'barred'
export type Phone = { label: string; sub: string; mood: Mood; talk: boolean }
export type Mine = {
  frozen: boolean
  barred: boolean
  /** A duel this player is not in. */
  spectator: boolean
  /**
   * Both seated players missed: `buzzable` is `[]` and nobody at all may buzz.
   *
   * Public, so it could have been the moment `duel:dead` — but the wall and the
   * phone want it at different priorities, and neither is wrong. The wall
   * narrates, so a miss still being read outranks the duel being over. The
   * phone answers "may I press", and to that question "nobody may, ever" beats
   * "reopening in a moment" — which during a dead duel is a promise nothing
   * will keep.
   */
  dead: boolean
  buzzableNames?: string[]
  /** This player is first in the order. */
  won: boolean
  /** Their margin behind first, when they buzzed and did not win. */
  deltaMs?: number
  /** This phone has pressed for this arm. Local, not from the order. */
  pressed: boolean
  /** ARMED or COLLECTING — the round is live. */
  armed: boolean
  /** Past the arm instant: the buzzers are actually open. */
  open: boolean
  /** `!!round.judge` — the judge's spoken-answer window is open. */
  judging: boolean
  /** Where this player (or their team) finished: 1 is the top, ties share. */
  place?: number
  /** What the next question is worth, for the wait between questions. */
  next?: number
  /** That next question is the setlist's last. */
  last?: boolean
  /** This phone's pick on a choice question. */
  pick?: number
  choices?: string[]
  correct?: number
  /** This phone's number on a closest question, the unit, and at the reveal the answer and what it paid. */
  guess?: number
  unit?: string
  plain?: boolean
  truth?: number
  paid?: number
  /** Guessing has closed, or the board is still playing the reveal: no pad, nothing to give away. */
  closed?: boolean
  /** `round.nearest`: whether a paid guess took first place or second. */
  nearest?: number
  /** The round value, for the reveal's "+200". */
  value?: number
  /** Actual award for a buzz answer; modes may add a power bonus. */
  awardPoints?: number
}

/**
 * What the phone's big button says, in priority order.
 *
 * Two rules hold it together. Only the player actually answering gets a screen
 * of their own — everyone else is some flavour of "not you", and flavouring it
 * further just puts information on a phone whose job right now is to be quiet.
 * And the phone never learns anything the room has not been told: `viewFor`
 * redacts the buzz order down to your own entry, so there is no name to show
 * even if it wanted to.
 */
export function phoneOf(m: Moment, f: Mine): Phone {
  // Above every personal state: nothing is live under an arrival. The phone's
  // arrival copy comes from `arrivalPresentation`; these are its fallback words.
  if (m === 'arrival:lobby') {
    return { label: 'Test buzzer', sub: 'Practice only · no points', mood: 'waiting', talk: false }
  }
  if (m === 'arrival:introduction') {
    return { label: 'Wait', sub: 'Waiting for the host', mood: 'waiting', talk: false }
  }
  if (m === 'idle:finale') {
    return f.place === 1
      ? { label: 'Winner', sub: 'Top of the standings', mood: 'first', talk: false }
      : { label: 'Final', sub: f.place ? `${ordinal(f.place)} place` : '', mood: 'waiting', talk: false }
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
  // Above the answer states, unlike on the wall. See `Mine.dead`.
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
      // Brass is first place only; a half-paying second is placed, like the board's silver.
      if (off === f.nearest) return { label: off === 0 ? 'Exact' : 'Nearest', sub, mood: 'first', talk: false }
      return { label: 'Second', sub, mood: 'placed', talk: false }
    }
    return { label: `${formatNumber(off, f.plain)} off`, sub: `It was ${truth}`, mood: 'barred', talk: false }
  }
  // Phones have no award-stamp dwell, so their local moment may already be
  // idle:ready while the scored round is still up. The answerer keeps the
  // actual result until the next arm clears its award and order.
  if ((m === 'verdict:award' || m === 'idle:ready') && f.won && f.awardPoints !== undefined) {
    return { label: 'Right', sub: `+${f.awardPoints}`, mood: 'first', talk: false }
  }
  // The buzzers being shut is what "somebody is answering" means to a phone.
  // A transcript typing itself out over an *open* rebound is not that: the
  // question is live again and this phone may press.
  const shut = !f.armed && (isFamily(m, 'answer') || m === 'verdict:hold')

  // The one branch where the mic can mount: this phone is the locked-in
  // leader and the judge's window is open. `talk` rides `f.judging` rather
  // than a boolean of its own — `<Talk>`'s whole lifetime is this branch, so
  // there is exactly one place that decides it is the one answering.
  if (f.won && shut) return { label: 'You’re up', sub: 'Answer it', mood: 'first', talk: f.judging }
  // The press has gone but the window is still filling, and the room learns
  // nothing for a whole second.
  //
  // `armed`, not "not locked". `pressed` is keyed on the arm, so it stays true
  // for the whole question however that question ends — and a scored one ends
  // IDLE, which is neither armed nor locked.
  if (f.pressed && f.armed) {
    return { label: 'In', sub: 'Counting the rest of the field', mood: 'placed', talk: false }
  }
  // Second place is locked too, and gets no placement readout: that is a result
  // on a screen whose only job is to say "not you", and the margin is already on
  // the board in front of the whole room.
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
  // Between questions the phone reads the same card as the wall.
  if (m === 'idle:ready' && f.next !== undefined) {
    return { label: 'Wait', sub: `${f.last ? 'Last' : 'Next'} question · ${f.next} points`, mood: 'waiting', talk: false }
  }
  return { label: 'Wait', sub: 'The host has not armed yet', mood: 'waiting', talk: false }
}

const withUnit = (n: number, unit?: string, plain?: boolean) => (unit ? `${formatNumber(n, plain)} ${unit}` : formatNumber(n, plain))

const ordinal = (n: number) => {
  const t = n % 100
  return `${n}${t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
}
