/**
 * Where a question is, and what each surface may show while it is there.
 *
 * Every display bug this month was the same shape: a condition that matched in
 * a state nobody was thinking about, because the state before it had stopped
 * matching. The board decided what to show from six overlapping booleans spread
 * across three JSX blocks — 2^6 combinations, of which about a dozen mean
 * anything, and nothing anywhere said which dozen. This names the dozen.
 *
 * `momentOf` is universal. `viewFor` redacts `order`, `whole`, and (without the
 * mirror) `fragments` and `answer` — but keeps `phase`, `armedAt`, `spoken`,
 * `award`, `held`, `duel` and `candidates`, which is every field a moment is
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
import type { State } from './protocol.ts'

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
  if (r.award && !local.retired) {
    return r.award.points < 0 ? 'verdict:penalty' : 'verdict:award'
  }

  if (state.duel && !state.duel.seated) return 'duel:nominating'
  // `[]`, not absent: both finalists missed, and nobody at all may buzz.
  if (r.candidates?.length === 0) return 'duel:dead'
  if (r.candidates?.length === 2 || state.duel?.seated) return 'duel:faceoff'

  if (r.phase === 'COLLECTING') return 'buzz:collecting'
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
  award: { name: string; points: number; answer?: string } | null
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
 * Priority order, and it is the board's own, ported: a nomination window and a
 * dead duel outrank the clue, a faceoff yields to it.
 */
function middleOf(state: State, m: Moment, hero: Wall['hero'], reading: boolean): Middle {
  const r = state.round
  if (hero) return { hero }
  if (m === 'duel:nominating') return { nominations: state.mode === 'teams' ? 'teams' : 'solo' }
  if (m === 'duel:dead') return { call: 'dead' }
  // The reading view and the buzz call are alternatives, not a sequence. While
  // the box is driving, the question owns the middle for the whole question —
  // empty at the arm, filling as the voice reaches each clause.
  if (reading || r.fragments?.length) {
    return { clue: { whole: r.whole, shown: r.fragments?.join(' ') ?? '' } }
  }
  const seated = r.candidates ?? state.duel?.seated
  if (seated?.length === 2) {
    const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
    return { faceoff: [nameOf(seated[0]), nameOf(seated[1])] }
  }
  return { call: m === 'buzz:open' ? 'buzz' : isFamily(m, 'buzz') ? 'standby' : 'ready' }
}

export function wallOf(state: State, local: Local): Wall {
  const r = state.round
  const m = momentOf(state, local)

  // A payoff stays until the next arm; a penalty is a beat, and the room goes
  // back to the question after it. A held rebound overrides that dwell, because
  // the server is showing the miss until it opens the buzzers and the board
  // must not go dark in between.
  const showAward = !!r.award && (m === 'verdict:award' || m === 'verdict:penalty' || m === 'verdict:hold')
  const penalised = showAward && !!r.award && r.award.points < 0

  // The leader owns the middle for as long as there is one. Not from `order`
  // itself — `wallOf` is the board's, so `order` is whole here, but a moment
  // must never depend on it.
  const leader = m === 'answer:locked' || m === 'buzz:collecting' ? r.order[0] : undefined
  const hero: Wall['hero'] = leader
    ? { name: leader.name, tone: 'answering' }
    : m === 'answer:judging' && r.spoken
      ? // The verdict clears `order` the instant it lands, but the room is still
        // reading the transcript above. Without this the stage flicks back to
        // the clue for two seconds and is taken away again when the stamp
        // arrives — the question appearing to resume under an answer nobody has
        // been told the result of.
        { name: r.spoken.name, tone: 'answering' }
      : penalised && r.award
        ? // The room reads the −400 against who it happened to, in the same
          // tally-red as the stamp above it, so the miss reads as one thing.
          { name: r.award.name, tone: 'penalised' }
        : null

  const reading = !!state.reading?.running

  return {
    moment: m,
    ...EMPTY_MIDDLE,
    ...middleOf(state, m, hero, reading),
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
export type Phone = { label: string; sub: string; mood: Mood }
export type Mine = {
  frozen: boolean
  barred: boolean
  /** A duel this player is not in. */
  spectator: boolean
  /**
   * Both finalists missed: `candidates` is `[]` and nobody at all may buzz.
   *
   * Public, so it could have been the moment `duel:dead` — but the wall and the
   * phone want it at different priorities, and neither is wrong. The wall
   * narrates, so a miss still being read outranks the duel being over. The
   * phone answers "may I press", and to that question "nobody may, ever" beats
   * "reopening in a moment" — which during a dead duel is a promise nothing
   * will keep.
   */
  dead: boolean
  finalistNames?: string[]
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
    return { label: 'Frozen', sub: 'A freeze item shut you out of this question', mood: 'barred' }
  }
  if (f.barred) {
    return { label: 'Out', sub: 'Wrong answer — you sit out the rest of this question', mood: 'barred' }
  }
  // Above the answer states, unlike on the wall. See `Mine.dead`.
  if (f.dead) {
    return { label: 'Duel', sub: 'Both missed — waiting for the host', mood: 'barred' }
  }
  if (f.spectator) {
    return {
      label: 'Duel',
      sub: `${f.finalistNames?.join(' vs ')} — you sit this one out`,
      mood: 'barred',
    }
  }
  // The buzzers being shut is what "somebody is answering" means to a phone.
  // A transcript typing itself out over an *open* rebound is not that: the
  // question is live again and this phone may press.
  const shut = !f.armed && (isFamily(m, 'answer') || m === 'verdict:hold')

  if (f.won && shut) return { label: 'You’re up', sub: 'Answer it', mood: 'first' }
  // The press has gone but the window is still filling, and the room learns
  // nothing for a whole second.
  //
  // `armed`, not "not locked". `pressed` is keyed on the arm, so it stays true
  // for the whole question however that question ends — and a scored one ends
  // IDLE, which is neither armed nor locked.
  if (f.pressed && f.armed) {
    return { label: 'In', sub: 'Counting the rest of the field', mood: 'placed' }
  }
  // Second place is locked too. It used to get a placement readout of its own,
  // which is a result on a screen whose only job is to say "not you" — and the
  // margin is on the board, in front of the whole room, already.
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
    }
  }
  if (f.open) return { label: 'Buzz', sub: '', mood: 'open' }
  if (f.armed) return { label: 'Wait', sub: 'Any moment', mood: 'waiting' }
  return { label: 'Wait', sub: 'The host has not armed yet', mood: 'waiting' }
}
