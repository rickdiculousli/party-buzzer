import { useSocket } from './useSocket.ts'
import type { HostAction, ScoreKey, State } from '../shared/protocol.ts'

function rows(state: State): { key: ScoreKey; label: string; score: number }[] {
  if (state.mode === 'teams') {
    return state.teams.map((t) => ({
      key: t.id,
      label: t.name,
      score: state.scores[t.id] ?? 0,
    }))
  }
  return state.players.map((p) => ({
    key: p.id,
    label: p.name,
    score: state.scores[p.id] ?? 0,
  }))
}

export function Host() {
  const { state, connected, send } = useSocket('host')
  const act = (action: HostAction) => send({ t: 'host', action })

  if (!state) return <main class="host"><p>Connecting…</p></main>

  const { round } = state
  const leader = round.order[0]
  const open = round.phase === 'ARMED' || round.phase === 'COLLECTING'

  return (
    <main class="host">
      <header>
        <h1>Host</h1>
        <span class={connected ? 'dot on' : 'dot off'} />
        <label>
          Value
          <input
            type="number"
            step={100}
            value={round.value}
            onInput={(e) =>
              act({ a: 'setValue', value: Number((e.target as HTMLInputElement).value) })
            }
          />
        </label>
        <label>
          Teams
          <input
            type="checkbox"
            checked={state.mode === 'teams'}
            onChange={(e) =>
              act({
                a: 'setMode',
                mode: (e.target as HTMLInputElement).checked ? 'teams' : 'solo',
              })
            }
          />
        </label>
      </header>

      <section class="controls">
        <button class="arm" onClick={() => act({ a: 'arm' })} disabled={open}>
          {open ? 'Buzzers open' : 'Arm'}
        </button>
        <button class="ok" onClick={() => act({ a: 'correct' })} disabled={!leader}>
          Correct +{round.value}
        </button>
        <button
          class="no"
          onClick={() => act({ a: 'wrong', neg: round.value })}
          disabled={!leader}
        >
          Wrong −{round.value}
        </button>
        <button onClick={() => act({ a: 'wrong', neg: 0 })} disabled={!leader}>
          Wrong (no neg)
        </button>
        <button onClick={() => act({ a: 'next' })}>Next question</button>
      </section>

      <section class="buzzes">
        <h2>Buzz order · {round.phase}</h2>
        {round.order.length === 0 && <p class="muted">No buzzes yet.</p>}
        <ol>
          {round.order.map((b, i) => (
            <li key={b.playerId} class={i === 0 ? 'lead' : ''}>
              <span>{b.name}</span>
              <span class="delta">{i === 0 ? 'first' : `+${b.deltaMs}ms`}</span>
            </li>
          ))}
        </ol>
        {round.lockedOut.length > 0 && (
          <p class="muted">Locked out this question: {round.lockedOut.length}</p>
        )}
      </section>

      <section class="scores">
        <h2>Scores</h2>
        <table>
          {rows(state).map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>
                <input
                  type="number"
                  value={r.score}
                  onChange={(e) =>
                    act({
                      a: 'setScore',
                      key: r.key,
                      score: Number((e.target as HTMLInputElement).value),
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </table>
      </section>

      <section class="players">
        <h2>Players</h2>
        {state.mode === 'teams' && (
          <button onClick={() => act({ a: 'addTeam', name: `Team ${state.teams.length + 1}`, color: '#6e56cf' })}>
            Add team
          </button>
        )}
        <table>
          {state.players.map((p) => (
            <tr key={p.id}>
              <td>
                <span class={p.connected ? 'dot on' : 'dot off'} />
                <input
                  value={p.name}
                  onChange={(e) =>
                    act({
                      a: 'rename',
                      playerId: p.id,
                      name: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </td>
              {state.mode === 'teams' && (
                <td>
                  <select
                    value={p.teamId ?? ''}
                    onChange={(e) =>
                      act({
                        a: 'assign',
                        playerId: p.id,
                        teamId: (e.target as HTMLSelectElement).value || undefined,
                      })
                    }
                  >
                    <option value="">—</option>
                    {state.teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
              )}
              <td>
                <button onClick={() => act({ a: 'kick', playerId: p.id })}>Kick</button>
              </td>
            </tr>
          ))}
        </table>
      </section>
    </main>
  )
}
