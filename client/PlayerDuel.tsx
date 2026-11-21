import { colorForPlayer, eligibleForDuel } from './ui.ts'
import { Votes } from './Votes.tsx'
import type { ClientMsg, State } from '../shared/protocol.ts'

export function PlayerDuel({
  state,
  playerId,
  send,
}: {
  state: State
  playerId: string | null
  send: (m: ClientMsg) => void
}) {
  const duel = state.duel
  if (!duel) return null

  const round = state.round
  const duelRule = state.duelRules.find((r) => r.id === duel.rule)
  const myDuelEntry = duel.pool.find((e) => e.playerId === playerId)
  const myVoteFor = duel.pool.find((e) => e.votes.includes(playerId ?? ''))?.playerId
  const inCount = duel.pool.filter((e) => e.in).length
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? '?'
  const seatedNames = duel.seated?.map(nameOf)

  const myTeam = state.players.find((p) => p.id === playerId)?.teamId
  const nominees = eligibleForDuel(state).filter(
    (p) => p.id !== playerId && (state.grouping !== 'teams' || p.teamId === myTeam),
  )
  const canNominate = state.grouping !== 'teams' || !!myTeam

  return (
    <>
      {duel.seated && !round.buzzable && (
        <div class={duel.seated.includes(playerId ?? '') ? 'player__duel fx-tada' : 'player__duel'}>
          <p class="eyebrow">Heads-up</p>
          <p class="player__faceoff">
            {seatedNames?.[0]} <span class="muted">vs</span> {seatedNames?.[1]}
          </p>
          <p class="muted">
            {duel.seated.includes(playerId ?? '')
              ? 'You’re one of them — your buzzer opens when the host arms'
              : 'You sit this one out'}
          </p>
        </div>
      )}

      {!duel.seated && duelRule && duelRule.entry !== 'none' && (
        <div class="player__duel">
          <p class="eyebrow">Heads-up — who plays?</p>
          {(duelRule.entry === 'volunteer' || duelRule.entry === 'both') && (
            <>
              <button
                class={myDuelEntry?.in ? 'btn btn--primary' : 'btn'}
                onPointerDown={() =>
                  send({ t: 'act', act: myDuelEntry?.in ? 'duelBackOff' : 'duelVolunteer' })
                }
              >
                {myDuelEntry?.in ? 'Back off' : 'I’m in'}
              </button>
              <p class="muted">
                {inCount} in{inCount > 2 ? ' — someone has to back off' : ''}
              </p>
            </>
          )}
          {(duelRule.entry === 'vote' || duelRule.entry === 'both') &&
            (!canNominate ? (
              <p class="muted">You are not on a team yet — ask the host to put you on one.</p>
            ) : (
              <>
                {nominees.map((p) => {
                  const votes = duel.pool.find((e) => e.playerId === p.id)?.votes ?? []
                  return (
                    <button
                      key={p.id}
                      class={myVoteFor === p.id ? 'btn nom-btn is-mine fx-nudge' : 'btn nom-btn'}
                      style={{ '--id': colorForPlayer(state, p.id) }}
                      onPointerDown={() => send({ t: 'act', act: 'duelVote', data: p.id })}
                    >
                      <span class="nom-btn__name">{p.name}</span>
                      <Votes voters={votes} />
                    </button>
                  )
                })}
                <p class="muted">
                  {myVoteFor
                    ? 'Tap them again to take your vote back'
                    : state.grouping === 'teams'
                      ? 'One vote each — your team picks its own'
                      : 'One vote each'}
                </p>
              </>
            ))}
        </div>
      )}
    </>
  )
}
