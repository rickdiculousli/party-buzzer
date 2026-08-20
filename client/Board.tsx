import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, lockedNames, standings, willSeat } from './ui.ts'
import { markGap, play, playSpaced, prime, startBed, stopBed, unlock } from './sound.ts'
import { Votes } from './Votes.tsx'
import { Spoken } from './Spoken.tsx'
import { wallOf, type Wall } from '../shared/wall.ts'
import { useReveal } from './useReveal.ts'
import { COLLECT_MS, type BuzzEntry, type State } from '../shared/protocol.ts'

type Mark = BuzzEntry & { lane: number }

/** `wallOf` names the tone; the stylesheet is where it becomes a colour. */
const HERO_CLASS: Record<NonNullable<Wall['hero']>['tone'], string> = {
  answering: 'board__hero',
  // Not brass — brass is what a payoff looks like. Same tally-red as the stamp
  // above it, so the three parts of a miss read as one thing.
  penalised: 'board__hero is-penalised',
}

/** The middle band when nobody owns it: what the room is being told to do. */
const CALL_TEXT: Record<NonNullable<Wall['call']>, string> = {
  buzz: 'Buzz',
  standby: 'Stand by',
  ready: 'Ready',
  dead: 'Both missed — waiting for the host',
}

/**
 * How much rail a mark's labels need, as a percentage of the rail.
 *
 * ponytail: assumes the rail is at its 58rem maximum rather than measuring it.
 * On a narrower board this under-estimates and marks pack a little tighter than
 * they should. Measure with a ResizeObserver if that ever actually bites.
 */
function labelWidth(name: string): number {
  const rem = Math.max(2.5, name.length * 0.68)
  return (rem / 58) * 100
}

/**
 * Lay the marks into rows. A mark drops to the next row down whenever it would
 * collide with whatever is already sitting beside it, so a cluster becomes a
 * staircase instead of a pile of overlapping names.
 */
function lay(entries: BuzzEntry[], width: number): Mark[] {
  const rowEnd: number[] = []
  return entries
    .slice()
    .sort((a, b) => a.deltaMs - b.deltaMs)
    .map((e) => {
      const at = (e.deltaMs / width) * 100
      const half = labelWidth(e.name) / 2
      let lane = rowEnd.findIndex((end) => at - half >= end)
      if (lane === -1) lane = rowEnd.length
      rowEnd[lane] = at + half + 1.5
      return { ...e, lane }
    })
}

/**
 * `enter` is how long each mark waits before it lands, by player id — assigned
 * once when the mark is first seen and never recomputed, so a re-render cannot
 * move a landing that has already been scheduled.
 */
function Timeline({
  state,
  round,
  enter,
}: {
  state: State
  round: State['round']
  enter: Map<string, number>
}) {
  // Fixed scale, not autoranged. Collection always runs exactly one second, so
  // the rail always means the same thing: a tight finish reads as a tight
  // finish instead of being stretched across the wall, and two questions can be
  // compared by eye.
  const marks = lay(round.order, COLLECT_MS)
  const lanes = Math.max(...marks.map((m) => m.lane)) + 1

  return (
    <div class="timeline">
      {/* Scale above the rail, marks below it. The last mark always lands at
          full scale, so a scale printed underneath collides with it and
          repeats its number. */}
      <div class="timeline__scale">
        <span>0 ms</span>
        <span>{COLLECT_MS} ms</span>
      </div>
      <div class="timeline__rail" />
      <ol class="timeline__marks" style={{ '--lanes': lanes }}>
        {marks.map((b) => (
          <li
            key={b.playerId}
            class="timeline__mark"
            style={{
              '--at': `${Math.min(100, (b.deltaMs / COLLECT_MS) * 100)}%`,
              '--lane': b.lane,
              '--id': colorForPlayer(state, b.playerId),
              '--enter': `${enter.get(b.playerId) ?? 0}ms`,
            }}
          >
            <span class="timeline__pin" />
            <span class="timeline__name">{b.name}</span>
            {/* First place is the datum the others are measured from; the axis
                already says 0, so "+0" would only add noise. */}
            <span class="timeline__ms readout">
              {b.deltaMs === 0 ? '' : `+${b.deltaMs}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * A ranked column of nominations.
 *
 * Ranked for display; lit by the same prediction the host desk runs, which is
 * not the same as the top two. In teams mode a same-team runner-up gets
 * skipped, and marking them anyway promises the room a face-off the close will
 * not produce.
 */
function NomList({
  state,
  entries,
  seating,
}: {
  state: State
  entries: NonNullable<State['duel']>['pool']
  seating: string[] | null
}) {
  return (
    <ol class="board__pool">
      {entries
        .slice()
        .sort((a, b) => b.votes.length - a.votes.length)
        .map((e) => (
          <li key={e.playerId} class={seating?.includes(e.playerId) ? 'nom is-lead' : 'nom'}>
            <span class="nom__name">
              {state.players.find((p) => p.id === e.playerId)?.name ?? '?'}
            </span>
            {e.in && <span class="chip chip--armed">In</span>}
            <Votes voters={e.votes} />
          </li>
        ))}
    </ol>
  )
}

/**
 * The question on the wall, laid out whole from the first frame.
 *
 * The board is given the entire question at the arm and renders all of it; only
 * the part the voice has not reached is invisible. That is the difference
 * between a line that assembles and one that jumps — with the words absent, the
 * paragraph rewrapped on every clause, and every word already up moved
 * sideways to make room. Invisible text still takes its space, so each word
 * lands where it was always going to be and simply appears there.
 *
 * `shown` is a prefix of `whole` by construction — both are the same fragments
 * joined the same way — so it can be sliced by length rather than matched.
 * Without `whole` (a host reading by hand, an older snapshot) it degrades to
 * printing what has been said, which is what this did before.
 */
function Question({ whole, shown }: { whole?: string; shown: string }) {
  if (!whole) return <p class="board__question">{shown}</p>
  return (
    <p class="board__question">
      {whole.slice(0, shown.length)}
      <span class="board__unsaid">{whole.slice(shown.length)}</span>
    </p>
  )
}

export function Board() {
  const { state, now, connected } = useSocket('board')
  // The big screen is what the room watches, so it must not light up before
  // the phones do. Same countdown to armedAt as every other surface.
  const { open, lead } = useOpen(state?.round, now)

  /**
   * The board is the only surface with a speaker the whole room can hear, and
   * browsers will not let it use one until somebody clicks. One click anywhere
   * is enough for the night; until then the chip below says so, because silence
   * with no explanation is the kind of thing you discover mid-game.
   */
  const [audible, setAudible] = useState(false)
  // The anchor cues are recipes, but recipes over real files, so their bytes
  // still have to be decoded — on the click, because that is the first moment
  // there is a context to decode into. The welcome bed decodes itself when the
  // lobby asks for it.
  useEffect(() => {
    const go = () => {
      unlock()
      prime('stamp', 'leader', 'award', 'penalty')
      setAudible(true)
    }
    document.addEventListener('pointerdown', go, { once: true })
    return () => document.removeEventListener('pointerdown', go)
  }, [])

  /**
   * The welcome screen: the board is up, nobody has buzzed, and no question has
   * been scored all night. The bed runs under it and fades out for good when the
   * host arms the first question.
   *
   * Deliberately not "the round is idle" — that is also true between every pair
   * of questions, and music swelling back up for four seconds each time the host
   * reaches for the next card would be unbearable by round three.
   */
  const welcoming =
    !!state &&
    state.round.phase === 'IDLE' &&
    state.round.order.length === 0 &&
    Object.values(state.scores).every((s) => s === 0)
  useEffect(() => {
    if (!audible) return
    if (welcoming) startBed('welcome')
    else stopBed()
  }, [welcoming, audible])

  /**
   * When each mark is allowed to land, so no two ever crowd each other.
   *
   * Batching alone was not enough. The hub holds the first 150ms back and
   * publishes it in one packet, but everything after that arrives in its own —
   * so two people pressing 30ms apart late in the window produced two marks
   * 30ms apart, which is one thump and one blur however the batch was spaced.
   * Packets are an implementation detail of the wire; what the room can take in
   * is not.
   *
   * So marks queue: each takes the later of now and the next free slot, and
   * claims the gap after it. A mark arriving on a quiet board waits for nothing.
   * The rail still plots every buzz at its true millisecond — this delays the
   * telling, never the measurement.
   */
  const enter = useRef(new Map<string, number>())
  const nextSlot = useRef(0)
  const round0 = useRef(-1)

  const order = state?.round.order ?? []
  const buzzes = order.length
  if (state && state.round.armedAt !== round0.current) {
    round0.current = state.round.armedAt
    // Only the assignments. `nextSlot` carries over: a slot already claimed is
    // claimed whatever round it belonged to, and one long past costs nothing.
    enter.current = new Map()
  }
  // Assigned during render because the marks are rendered now, and only for
  // ids not already scheduled — which makes a second render of the same state
  // a no-op rather than a reshuffle.
  const nowMs = performance.now()
  const gap = markGap()
  for (const b of order) {
    if (enter.current.has(b.playerId)) continue
    const at = Math.max(nowMs, nextSlot.current)
    enter.current.set(b.playerId, Math.round(at - nowMs))
    nextSlot.current = at + gap
  }

  const seen = useRef(0)
  useEffect(() => {
    const was = seen.current
    seen.current = buzzes
    if (buzzes <= was) return
    // Spaced on the audio clock rather than by the delay its mark got. The two
    // queues agree on the gap but not on the instant, because they cannot: this
    // effect runs some unknown time after the render that placed the marks.
    for (let i = was; i < buzzes; i++)
      playSpaced(i === 0 ? 'leader' : 'stamp')
  }, [buzzes])

  // Two clocks the room reads on but `State` knows nothing about: how long a
  // transcript takes to type and how long a penalty sits. `wallOf` wants the
  // answers, not the apparatus.
  const { settled, retired, onSettled } = useReveal(state?.round)

  if (!state) return <main class="board"><p class="board__idle">Connecting</p></main>

  const { round } = state
  /**
   * What the wall shows, decided once in `shared/wall.ts` rather than by six
   * overlapping booleans across three JSX blocks. The board keeps only the
   * three clocks the module is not allowed to read: the countdown to `armedAt`,
   * the transcript having settled, and the penalty dwell having elapsed.
   */
  const w = wallOf(state, { open, settled, retired })
  const leader = round.order[0]
  const armed = round.phase === 'ARMED' || round.phase === 'COLLECTING'
  const here = state.players.filter((p) => p.connected).length
  const barred = lockedNames(state)
  // `candidates` is only stamped at the arm, so between the host seating a pair
  // and opening the buzzers there is a gap the board used to spend saying
  // "Ready" — the room watches the two names disappear a second after they were
  // announced. The seated pair carries it across that gap; once the arm stamps
  // candidates, that is the truer source, because a wrong answer narrows it.
  const seating = willSeat(state)

  return (
    <main class="board">
      <section class="board__wall">
        <div class="board__status">
          {open && <span class="chip chip--open">Open</span>}
          {armed && !open && <span class="chip chip--armed">Standing by</span>}
          <span class="chip">
            {here} {here === 1 ? 'player' : 'players'}
          </span>
          {/* Position, not drama. The stage belongs to the question; a flow that
              pulls the eye during a buzz has failed at its job. */}
          {state.flow?.blocks[state.flow.at] && (
            <span class="chip">
              {state.flow.at + 1}/{state.flow.blocks.length} · Q{state.flow.done + 1} of{' '}
              {state.flow.blocks[state.flow.at].count}
            </span>
          )}
          {/* What is at stake. The idle stage shows this large; once someone is
              answering the stage belongs to them, so it shrinks to a chip. */}
          {leader && <span class="chip chip--armed">{round.value}</span>}
          {!audible && <span class="chip">Click for sound</span>}
        </div>

        {/*
          Three bands, not a stack. The middle one holds whatever the room is
          actually reading and sits at the exact centre of the stage no matter
          what is in the other two, so the award arriving above it and the
          timeline filling in below it never move it. A name that drifted up the
          screen as its own timeline assembled would undo the point of stamping
          the marks down in the first place.
        */}
        <div class="board__above">
          {/* What was said, as the judge heard it — the award's evidence while
              the points are up, and the whole story while a rebound runs. */}
          {w.transcript && (
            <Spoken
              prefix="board"
              transcript={w.transcript.text}
              hit={w.transcript.hit}
              onSettled={onSettled}
            />
          )}
          {/* The payoff — or its mirror, a penalty stamped negative. Stays up
              until the next question is armed, because the room looks at the
              board after the host scores it, not before. A penalty's leader
              is already gone to the rebound, so this gates on the award. */}
          {w.award && (
            <p class={w.award.points < 0 ? 'board__award is-neg' : 'board__award'}>
              {w.award.points > 0 ? '+' : ''}
              {w.award.points}
            </p>
          )}
          {w.award?.answer && <p class="board__answer">{w.award.answer}</p>}
        </div>

        {/* The cue escalates through three sizes and the reserved line is what
            keeps the band from growing under it; a name owning the stage does
            not need it. Only the neutral hero — a penalty's name is a beat over
            a question still in progress, and the band it sits in is the cue's. */}
        <div class={w.hero?.tone === 'answering' ? 'board__mid' : 'board__mid board__mid--cue'}>
          {w.hero && <p class={HERO_CLASS[w.hero.tone]}>{w.hero.name}</p>}
          {w.nominations && (
            <div class="board__noms">
              <p class="board__idle">Who plays?</p>
              {w.nominations === 'teams' ? (
                // A column per side, because that is the shape of the decision:
                // two rooms picking one name each, and the seat takes the top of
                // each column. One merged list made the close look like it was
                // reaching past the runner-up for no reason — here the runner-up
                // is visibly in the wrong column. An empty column stays up, so
                // the room can see which side has not made up its mind.
                <div class="board__sides">
                  {state.teams.map((team) => (
                    <div key={team.id} class="board__sidepool">
                      <p class="eyebrow" style={{ color: team.color }}>
                        {team.name}
                      </p>
                      <NomList
                        state={state}
                        seating={seating}
                        entries={state.duel!.pool.filter(
                          (e) =>
                            state.players.find((p) => p.id === e.playerId)?.teamId === team.id,
                        )}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <NomList state={state} seating={seating} entries={state.duel!.pool} />
              )}
            </div>
          )}
          {w.clue && <Question {...w.clue} />}
          {/* The face-off yields the stage to the question text while the
              reader is speaking, and to the leader the moment someone buzzes. */}
          {w.faceoff && (
            <p class="board__faceoff">
              <span class="board__hero">{w.faceoff[0]}</span>
              <span class="board__idle">vs</span>
              <span class="board__hero">{w.faceoff[1]}</span>
            </p>
          )}
          {w.call && (
            <p class={w.call === 'buzz' ? 'board__call' : 'board__idle'}>{CALL_TEXT[w.call]}</p>
          )}
        </div>

        <div class="board__below">
          {/* `seen` still holds the previous count during render — the effect
              that advances it runs after. That is exactly the number a mark
              needs to know whether it arrived alone or in a crowd. */}
          {w.timeline && <Timeline state={state} round={round} enter={enter.current} />}
          {!leader && (
            <>
              {/* The slot is always here so the filament arriving does not
                  shove the value down a line. */}
              <div class="board__lead-in">
                {w.filament && (
                  // Keyed on the arm instant so the warm-up restarts once per
                  // arm and not on every unrelated broadcast.
                  <div
                    key={round.armedAt}
                    class={open ? 'filament is-hot' : 'filament'}
                    style={{ '--lead': `${lead}ms` }}
                  />
                )}
              </div>
              {/* What is at stake, and only while there is something at stake.
                  It used to sit there whatever the room was doing, so the end
                  of a read — reader stopped, stage back to "Ready", nobody
                  playing — left a bare 400 floating under it with nothing to
                  be the value of. */}
              {w.value !== null && <p class="board__value">{w.value}</p>}
            </>
          )}
        </div>

        {/* Status, not stage content — parked at the foot of the stage so a
            rebound's lockout chips never move the timeline above them. */}
        {barred.length > 0 && (
          <div class="board__barred">
            {barred.map((n) => (
              <span key={n} class="chip chip--barred">{n} out</span>
            ))}
          </div>
        )}
      </section>

      <aside class="board__side">
        <div class="board__standings">
          <p class="eyebrow">Standings</p>
          <ol class="stack">
            {standings(state).map((r, i) => (
              <li key={r.key} class="row" style={{ borderLeftColor: r.color }}>
                {/* Medals for the podium only, but the space is kept either
                    way so every name lines up. */}
                <span class={i < 3 ? `rank rank--${i + 1}` : 'rank'}>
                  {i < 3 ? ['1st', '2nd', '3rd'][i] : ''}
                </span>
                <span class="row__label">{r.label}</span>
                <span class="row__score readout">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Full size until the first player is in, then out of the way. */}
        <div class={state.players.length === 0 ? 'board__qr' : 'board__qr is-small'}>
          <img src="/qr.svg" alt="Scan to join" />
          <p>Scan to join</p>
        </div>

        {/* The room never needs this, but the host glancing at the wall does. */}
        <span class="lamp">
          <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </aside>
    </main>
  )
}
