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
import type { Award, State } from './protocol.ts'

/**
 * The thirteen states, in priority order — `momentOf` returns the first that
 * matches, and that ordering is the load-bearing part.
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
  | 'answer:judging'
  | 'verdict:hold'
  | 'answer:locked'
  | 'verdict:penalty'
  | 'verdict:award'
  | 'duel:nominating'
  | 'duel:dead'
  | 'duel:faceoff'
  | 'buzz:collecting'
  | 'buzz:open'
  | 'buzz:arming'
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

export type Family = 'answer' | 'verdict' | 'duel' | 'buzz' | 'idle'
/** Typed prefix matching, so a family question stays one line and stays checked. */
export function isFamily<F extends Family>(m: Moment, f: F): m is Extract<Moment, `${F}:${string}`> {
  return m.startsWith(`${f}:`)
}

export function momentOf(state: State, local: Local): Moment {
  const r = state.round

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
  const rebounding = r.buzzable?.length === 1 && r.phase === 'ARMED'
  if (r.award && r.phase !== 'COLLECTING' && (!local.retired || rebounding)) {
    return isPenalty(r.award) ? 'verdict:penalty' : 'verdict:award'
  }

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
  const started = r.armedAt > 0 || Object.values(state.scores).some((n) => n !== 0)
  return started ? 'idle:ready' : 'idle:welcome'
}

/**
 * What is on the big screen.
 *
 * The invariant, and the point of the whole file: exactly one of `hero`,
 * `clue`, `nominations`, `faceoff` and `call` is non-null. Those five are the
 * middle band's occupants, and the seven-branch ternary they replace existed
 * only because nothing ever said they were mutually exclusive.
 *
 * The other five are the bands above and below, and may co-occur with the
 * middle one — a miss is legitimately transcript, award and hero at once.
 */
export type Wall = {
  moment: Moment
  hero: { name: string; tone: 'answering' | 'penalised' } | null
  clue: { whole?: string; shown: string } | null
  nominations: 'solo' | 'teams' | null
  faceoff: [string, string] | null
  call: 'buzz' | 'standby' | 'ready' | 'dead' | null

  transcript: { name: string; text: string; hit: boolean } | null
  award: (Award & { answer?: string }) | null
  timeline: boolean
  filament: boolean
  value: number | null
}

/**
 * The middle band's one occupant, as a one-key object.
 *
 * The type is the invariant: a `Middle` cannot name two occupants, so
 * "exactly one of five" is enforced by the compiler rather than asserted in a
 * comment and hoped for. Four `let`s initialised to null and assigned in a
 * branch said the same thing and guaranteed none of it.
 */
type Middle =
  | { hero: NonNullable<Wall['hero']> }
  | { clue: NonNullable<Wall['clue']> }
  | { nominations: NonNullable<Wall['nominations']> }
  | { faceoff: NonNullable<Wall['faceoff']> }
  | { call: NonNullable<Wall['call']> }

const EMPTY_MIDDLE = {
  hero: null,
  clue: null,
  nominations: null,
  faceoff: null,
  call: null,
} satisfies Pick<Wall, 'hero' | 'clue' | 'nominations' | 'faceoff' | 'call'>

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
function middleOf(state: State, m: Moment): Middle {
  const r = state.round
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  const hero = (name?: string, tone: 'answering' | 'penalised' = 'answering') =>
    name ? ({ hero: { name, tone } } satisfies Middle) : null

  // The first choice that has anything to show. The fall-through is `ready`
  // because a stage with nothing on it is a stage waiting for the host.
  const or = (...xs: (Middle | null | undefined)[]): Middle =>
    xs.find((x) => x != null) ?? { call: 'ready' }

  // The question, while there is one on the stage: the box is mid-read, or what
  // it has read so far is still up. Empty at the arm, filling as the voice
  // reaches each clause.
  const clue: Middle | null =
    state.reading?.running || r.fragments?.length
      ? { clue: { whole: r.whole, shown: r.fragments?.join(' ') ?? '' } }
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
  const scorer = hero(r.award?.name, isPenalty(r.award) ? 'penalised' : 'answering')

  switch (m) {
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
    // A payoff yields, because it sits over the question rather than instead of
    // it — but with nothing left on the stage it is the name, not a bare
    // "Ready" under a +200 belonging to nobody.
    case 'verdict:award':
      return or(clue, scorer)
    case 'answer:locked':
    case 'buzz:collecting':
      // The pair is who *may* answer; the leader is who *is*. Before the order
      // is published — the hub holds it 150ms — the pair still holds the stage,
      // so a duel's buzz-in replaces it rather than blanking it first.
      return or(leader, clue, pair, { call: 'standby' })
    case 'duel:nominating':
      return { nominations: state.grouping === 'teams' ? 'teams' : 'solo' }
    case 'duel:dead':
      return { call: 'dead' }
    case 'duel:faceoff':
      return or(clue, pair)
    case 'buzz:open':
      return or(clue, { call: 'buzz' })
    case 'buzz:arming':
      return or(clue, { call: 'standby' })
    case 'idle:ready':
    case 'idle:welcome':
      return or(clue, { call: 'ready' })
  }
}

export function wallOf(state: State, local: Local): Wall {
  const r = state.round
  const m = momentOf(state, local)

  // A payoff stays until the next arm; a penalty is a beat, and the room goes
  // back to the question after it. A held rebound overrides that dwell, because
  // the server is showing the miss until it opens the buzzers and the board
  // must not go dark in between.
  const showAward = !!r.award && (m === 'verdict:award' || m === 'verdict:penalty' || m === 'verdict:hold')
  const penalised = showAward && isPenalty(r.award)

  const reading = !!state.reading?.running

  // The lower band's question, not the middle's: whose timeline, whose warm-up
  // bar, whose value. `middleOf` owns who is on the stage.
  const leader = m === 'answer:locked' || m === 'buzz:collecting' ? r.order[0] : undefined

  return {
    moment: m,
    ...EMPTY_MIDDLE,
    ...middleOf(state, m),
    transcript: r.spoken
      ? { name: r.spoken.name, text: r.spoken.transcript, hit: r.spoken.hit }
      : null,
    award:
      showAward && r.award ? { ...r.award, answer: r.answer } : null,
    timeline: !!leader && r.order.length > 1,
    // A miss holding the stage keeps the whole lower band out of the way, or
    // the room reads a warm-up bar counting down under the name it just cost.
    filament: !leader && isFamily(m, 'buzz'),
    value: !leader && !penalised && (isFamily(m, 'buzz') || reading) ? r.value : null,
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
          : f.deltaMs
            ? `+${f.deltaMs} ms`
            : '',
      mood: 'barred',
      talk: false,
    }
  }
  if (f.open) return { label: 'Buzz', sub: '', mood: 'open', talk: false }
  if (f.armed) return { label: 'Wait', sub: 'Any moment', mood: 'waiting', talk: false }
  return { label: 'Wait', sub: 'The host has not armed yet', mood: 'waiting', talk: false }
}
