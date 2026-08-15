import { useOpen, useSocket } from './useSocket.ts'
import type { State } from '../shared/protocol.ts'

function standings(state: State) {
  const rows =
    state.mode === 'teams'
      ? state.teams.map((t) => ({ key: t.id, label: t.name, color: t.color }))
      : state.players.map((p) => ({ key: p.id, label: p.name, color: '#6e56cf' }))
  return rows
    .map((r) => ({ ...r, score: state.scores[r.key] ?? 0 }))
    .sort((a, b) => b.score - a.score)
}

export function Board() {
  const { state, now } = useSocket('board')
  // The big screen is what the room watches, so it must not light up before
  // the phones do. Same countdown to armedAt as every other surface.
  const open = useOpen(state?.round, now)
  if (!state) return <main class="board"><p>Connecting…</p></main>

  const { round } = state
  const leader = round.order[0]

  return (
    <main class="board">
      <section class="stage">
        {leader ? (
          <>
            <p class="who">{leader.name}</p>
            <ol class="rest">
              {round.order.slice(1).map((b) => (
                <li key={b.playerId}>{b.name} <span class="delta">+{b.deltaMs}ms</span></li>
              ))}
            </ol>
          </>
        ) : (
          <p class={open ? 'armed' : 'idle'}>{open ? 'BUZZ!' : 'Ready'}</p>
        )}
      </section>

      <aside class="side">
        <ol class="standings">
          {standings(state).map((r) => (
            <li key={r.key} style={{ borderColor: r.color }}>
              <span>{r.label}</span>
              <span class="score">{r.score}</span>
            </li>
          ))}
        </ol>
        <div class="join-qr">
          <img src="/qr.svg" alt="Scan to join" />
          <p>Scan to join</p>
        </div>
      </aside>
    </main>
  )
}
