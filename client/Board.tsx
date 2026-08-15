import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, lockedNames, standings } from './ui.ts'
import { markGap, playSpaced, startBed, stopBed, unlock } from './sound.ts'
import { COLLECT_MS, type BuzzEntry, type State } from '../shared/protocol.ts'

type Mark = BuzzEntry & { lane: number }

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
  // Nothing to prime: all three anchor cues are recipes now, synthesized on the
  // spot, and the welcome bed decodes itself when the lobby asks for it.
  useEffect(() => {
    const go = () => {
      unlock()
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
      playSpaced(i === 0 ? ['leader', 'leader2'] : 'stamp')
  }, [buzzes])

  if (!state) return <main class="board"><p class="board__idle">Connecting</p></main>

  const { round } = state
  const leader = round.order[0]
  const armed = round.phase === 'ARMED' || round.phase === 'COLLECTING'
  const here = state.players.filter((p) => p.connected).length
  const barred = lockedNames(state)

  return (
    <main class="board">
      <section class="board__stage">
        <div class="board__status">
          {open && <span class="chip chip--live">Live</span>}
          {armed && !open && <span class="chip chip--armed">Standing by</span>}
          <span class="chip">
            {here} {here === 1 ? 'player' : 'players'}
          </span>
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
          {/* The payoff. Stays up until the next question is armed, because the
              room looks at the board after the host scores it, not before. */}
          {leader && round.award && <p class="board__award">+{round.award.points}</p>}
        </div>

        <div class={leader ? 'board__mid' : 'board__mid board__mid--cue'}>
          {leader ? (
            <p class="board__hero">{leader.name}</p>
          ) : (
            <p class={open ? 'board__call' : 'board__idle'}>
              {open ? 'Buzz' : armed ? 'Stand by' : 'Ready'}
            </p>
          )}
        </div>

        <div class="board__below">
          {leader ? (
            // `seen` still holds the previous count during render — the effect
            // that advances it runs after. That is exactly the number a mark
            // needs to know whether it arrived alone or in a crowd.
            round.order.length > 1 && (
              <Timeline state={state} round={round} enter={enter.current} />
            )
          ) : (
            <>
              {/* The slot is always here so the filament arriving does not
                  shove the value down a line. */}
              <div class="board__lead-in">
                {armed && (
                  // Keyed on the arm instant so the warm-up restarts once per
                  // arm and not on every unrelated broadcast.
                  <div
                    key={round.armedAt}
                    class={open ? 'filament is-hot' : 'filament'}
                    style={{ '--lead': `${lead}ms` }}
                  />
                )}
              </div>
              <p class="board__value">{round.value}</p>
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
