import { useState } from 'preact/hooks'
import type { HostAction, PlayerId, State } from '../shared/protocol.ts'

/**
 * Heads-up duels: open a window (or seat instantly), watch the pool, close it
 * into two finalists. Everything here is a projection of state.duel — the
 * resolution itself is server-side (server/duel.ts). The pool below is sorted
 * for display only; ties and the teams-mode one-per-team rule are settled by
 * the server when the window closes.
 */
export function DuelPanel({ state, act }: { state: State; act: (a: HostAction) => void }) {
  const [pick, setPick] = useState<PlayerId[]>([])
  const duel = state.duel
  const idle = state.round.phase === 'IDLE'
  const name = (id: PlayerId) => state.players.find((p) => p.id === id)?.name ?? '?'
  const eligible = state.players.filter(
    (p) => p.connected && (state.mode !== 'teams' || !!p.teamId),
  )

  if (!duel) {
    return (
      <section>
        <p class="eyebrow">Heads-up</p>
        <div class="host__minor">
          {state.duelRules.map((r) => (
            <button
              key={r.id}
              class="btn"
              disabled={!idle || eligible.length < 2}
              onClick={() => act({ a: 'openDuel', rule: r.id })}
            >
              {r.name}
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (duel.seated) {
    return (
      <section>
        <p class="eyebrow">Heads-up</p>
        <p>
          {name(duel.seated[0])} <span class="muted">vs</span> {name(duel.seated[1])}
        </p>
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel duel
        </button>
      </section>
    )
  }

  const rule = state.duelRules.find((r) => r.id === duel.rule)
  const toggle = (id: PlayerId) =>
    setPick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)))

  const pool = duel.pool.slice().sort((a, b) => b.votes.length - a.votes.length)

  return (
    <section>
      <p class="eyebrow">Heads-up — {rule?.name ?? duel.rule}</p>

      {rule && rule.entry !== 'none' &&
        (pool.length === 0 ? (
          <p class="muted">Waiting for the room…</p>
        ) : (
          <ol class="host__order">
            {pool.map((e) => (
              <li key={e.playerId} class="row">
                <span class="row__label">{name(e.playerId)}</span>
                <span class="readout readout--ms">
                  {[
                    e.votes.length > 0 && `${e.votes.length} vote${e.votes.length === 1 ? '' : 's'}`,
                    e.in && 'in',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        ))}

      <div class="host__minor" style={{ marginTop: 'var(--s2)' }}>
        {rule?.resolve !== 'host' && (
          <button class="btn btn--primary" onClick={() => act({ a: 'closeDuel' })}>
            Seat them
          </button>
        )}
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel
        </button>
      </div>

      <p class="eyebrow" style={{ marginTop: 'var(--s3)' }}>Or pick two</p>
      <div class="host__minor">
        {eligible.map((p) => (
          <button
            key={p.id}
            class={pick.includes(p.id) ? 'btn btn--primary' : 'btn'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button
          class="btn btn--go"
          disabled={pick.length !== 2}
          onClick={() => {
            act({ a: 'closeDuel', playerIds: [pick[0], pick[1]] })
            setPick([])
          }}
        >
          Seat these two
        </button>
      </div>
    </section>
  )
}
