import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, lockedNames, standings } from './ui.ts'
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

function Timeline({ state, round }: { state: State; round: State['round'] }) {
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
            round.order.length > 1 && <Timeline state={state} round={round} />
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
