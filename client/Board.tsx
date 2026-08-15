import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, lockedNames, standings } from './ui.ts'
import type { BuzzEntry, State } from '../shared/protocol.ts'

/**
 * The scale autoranges to the field, so the marks always use the full rail and
 * the gaps between them are readable however tight the finish was. The axis
 * label carries the magnitude — that is what tells you an 11ms rail apart from
 * a 400ms one.
 */
function span(order: BuzzEntry[]): number {
  return Math.max(1, ...order.map((b) => b.deltaMs))
}

function Timeline({ state, order }: { state: State; order: BuzzEntry[] }) {
  const width = span(order)
  return (
    <div class="timeline">
      <div class="timeline__rail" />
      <ol class="timeline__marks">
        {order.map((b) => (
          <li
            key={b.playerId}
            class="timeline__mark"
            style={{
              '--at': `${(b.deltaMs / width) * 100}%`,
              '--id': colorForPlayer(state, b.playerId),
            }}
          >
            <span class="timeline__pin" />
            <span class="timeline__name">{b.name}</span>
            {/* First place is the datum the others are measured from; the axis
                already says 0, so "+0" would only add noise. */}
            <span class="timeline__ms readout">{b.deltaMs === 0 ? '' : `+${b.deltaMs}`}</span>
          </li>
        ))}
      </ol>
      <div class="timeline__scale">
        <span>0 ms</span>
        <span>{width} ms</span>
      </div>
    </div>
  )
}

export function Board() {
  const { state, now } = useSocket('board')
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

        {leader ? (
          <>
            <p class="board__hero">{leader.name}</p>
            {round.order.length > 1 && <Timeline state={state} order={round.order} />}
          </>
        ) : (
          <>
            <p class={open ? 'board__call' : 'board__idle'}>
              {open ? 'Buzz' : armed ? 'Stand by' : 'Ready'}
            </p>
            {armed && (
              // Keyed on the arm instant so the warm-up restarts once per arm
              // and not on every unrelated broadcast.
              <div
                key={round.armedAt}
                class={open ? 'filament is-hot' : 'filament'}
                style={{ '--lead': `${lead}ms` }}
              />
            )}
            <p class="board__value">{round.value}</p>
          </>
        )}

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
            {standings(state).map((r) => (
              <li key={r.key} class="row" style={{ borderLeftColor: r.color }}>
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
      </aside>
    </main>
  )
}
