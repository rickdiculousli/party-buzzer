import { useEffect, useState } from 'preact/hooks'
import type { DuelRuleInfo, DuelState, HostAction, PlayerId, State } from '../shared/protocol.ts'
import { Votes } from './Votes.tsx'
import { eligibleForDuel, willSeat as seatPrediction } from './ui.ts'

const teamOf = (state: State, id: PlayerId) => state.players.find((p) => p.id === id)?.teamId

/** Why closing this window right now would resolve nothing, or null. */
function closeBlockReason(
  state: State,
  duel: DuelState,
  rule: DuelRuleInfo,
  eligibleIds: Set<PlayerId>,
): string | null {
  if (rule.resolve === 'votes') {
    return seatPrediction(state)
      ? null
      : 'No two eligible players have votes yet — closing now resolves nothing.'
  }
  if (rule.resolve === 'random') {
    const source =
      rule.entry === 'none'
        ? [...eligibleIds]
        : duel.pool.filter((e) => e.in && eligibleIds.has(e.playerId)).map((e) => e.playerId)
    if (source.length < 2) return 'Fewer than two are in — closing now resolves nothing.'
    if (state.grouping === 'teams' && new Set(source.map((id) => teamOf(state, id))).size < 2) {
      return 'Everyone still in is on one team — closing now resolves nothing.'
    }
  }
  return null
}

/**
 * Heads-up duels: open a window (or seat instantly), watch the pool, close it
 * into the seated pair. Everything here is a projection of state.duel — the
 * resolution itself is server-side (server/duel.ts). The pool below is sorted
 * for display only; ties and the teams one-per-team rule are settled by
 * the server when the window closes.
 */
export function DuelPanel({ state, act }: { state: State; act: (a: HostAction) => void }) {
  const [pick, setPick] = useState<PlayerId[]>([])
  const duel = state.duel
  const idle = state.round.phase === 'IDLE'
  const name = (id: PlayerId) => state.players.find((p) => p.id === id)?.name ?? '?'
  const eligible = eligibleForDuel(state)
  const eligibleIds = new Set(eligible.map((p) => p.id))

  // The panel never unmounts between duels — without this a stale pair from
  // a prior duel sits pre-selected and one tap seats players the host never
  // chose for this one.
  useEffect(() => {
    if (!duel) setPick([])
  }, [duel])

  if (!duel) {
    const teams = state.grouping === 'teams' ? new Set(eligible.map((p) => p.teamId)) : null
    return (
      <section>
        <p class="eyebrow">Heads-up</p>
        <div class="host__minor">
          {state.duelRules.map((r) => {
            // The only rule that seats instantly on open (entry:'none',
            // resolve:'random'); a teams grouping can pass the headcount check and
            // still fail the one-per-team seat, which otherwise deletes the
            // duel with nothing said about why.
            const randomBlocked = r.entry === 'none' && r.resolve === 'random' && teams && teams.size < 2
            return (
              <button
                key={r.id}
                class="btn"
                disabled={!idle || eligible.length < 2 || !!randomBlocked}
                onClick={() => act({ a: 'openDuel', rule: r.id })}
              >
                {r.name}
              </button>
            )
          })}
        </div>
        {idle && eligible.length >= 2 && teams && teams.size < 2 && (
          <p class="muted">Random draw needs two different teams — everyone eligible is on one.</p>
        )}
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
        <p class="muted">This pair also plays the next question, until Cancel or Next.</p>
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel duel
        </button>
      </section>
    )
  }

  const rule = state.duelRules.find((r) => r.id === duel.rule)
  const toggle = (id: PlayerId) =>
    setPick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)))

  const willSeat = seatPrediction(state)
  const pool = duel.pool.slice().sort((a, b) => b.votes.length - a.votes.length)
  const closeReason = rule ? closeBlockReason(state, duel, rule, eligibleIds) : null

  const pickSameTeam =
    pick.length === 2 && state.grouping === 'teams' && teamOf(state, pick[0]) === teamOf(state, pick[1])

  return (
    <section>
      <p class="eyebrow">Heads-up — {rule?.name ?? duel.rule}</p>

      {rule && rule.entry !== 'none' &&
        (pool.length === 0 ? (
          <p class="muted">Waiting for the room…</p>
        ) : (
          <ol class="host__order">
            {pool.map((e) => (
              <li
                key={e.playerId}
                class={willSeat?.includes(e.playerId) ? 'row is-lead' : 'row'}
              >
                <span class="row__label">{name(e.playerId)}</span>
                {e.in && <span class="chip chip--armed">In</span>}
                {/* Heads, not a cyan number: cyan is the measurement colour
                    and a vote measures nothing. The host desk keeps the digit
                    beside them because this is the screen the close is called
                    from, and at four apiece a count settles it faster. */}
                <Votes voters={e.votes} />
                {e.votes.length > 0 && <span class="readout">{e.votes.length}</span>}
              </li>
            ))}
          </ol>
        ))}

      <div class="host__minor" style={{ marginTop: 'var(--s2)' }}>
        {rule?.resolve !== 'host' && (
          <button
            class="btn btn--primary"
            disabled={!!closeReason}
            onClick={() => act({ a: 'closeDuel' })}
          >
            Seat them
          </button>
        )}
        <button class="btn btn--ghost" onClick={() => act({ a: 'cancelDuel' })}>
          Cancel
        </button>
      </div>
      {closeReason && <p class="muted">{closeReason}</p>}

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
          disabled={pick.length !== 2 || pickSameTeam}
          onClick={() => {
            act({ a: 'closeDuel', playerIds: [pick[0], pick[1]] })
            setPick([])
          }}
        >
          Seat these two
        </button>
      </div>
      {pickSameTeam && <p class="muted">Same team — pick two from different teams.</p>}
    </section>
  )
}
