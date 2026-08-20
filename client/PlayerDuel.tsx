import { colorForPlayer, eligibleForDuel } from './ui.ts'
import { Votes } from './Votes.tsx'
import type { ClientMsg, State } from '../shared/protocol.ts'

/**
 * The phone's half of a duel: who is seated once the window closes, and before
 * that, the entry controls — volunteer, back off, nominate. Pure derive-and-
 * render off `state`; every control is an `act` the server validates again.
 */
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

  /**
   * Who this phone may nominate, and whether it may nominate at all.
   *
   * `eligibleForDuel`, not every connected player: someone the seat can never
   * take — a phone that joined before the host made teams, and is still on
   * none — was being offered as a target, and a vote for them is spent on a
   * name the close will silently pass over. The same rule decides both
   * directions, so a player with no team is told why their card is empty
   * rather than voting into a duel they cannot be part of.
   *
   * Your own side only, in a teams grouping. The seat takes one player from each
   * team, so the nomination you are being asked for is your team's — picking
   * from the other side is choosing your opponent's champion, which is either
   * a courtesy or sabotage and never an answer to the question. The server
   * refuses a vote across the line for the same reason; this is the roster
   * agreeing with it rather than the rule itself.
   */
  const myTeam = state.players.find((p) => p.id === playerId)?.teamId
  const nominees = eligibleForDuel(state).filter(
    (p) => p.id !== playerId && (state.grouping !== 'teams' || p.teamId === myTeam),
  )
  const canNominate = state.grouping !== 'teams' || !!myTeam

  return (
    <>
      {/* Seated, not yet armed. The buzzer below still says "Wait" for everyone,
          which is the one moment it means two different things — so say which
          one it is here rather than letting a seated player find out by pressing. */}
      {duel.seated && !round.buzzable && (
        <div class="player__duel">
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
                      class={myVoteFor === p.id ? 'btn nom-btn is-mine' : 'btn nom-btn'}
                      // The identity rail, which in a teams grouping is the team's
                      // colour — the only thing on this list that says which
                      // side a name is on, and it matches the colour this
                      // phone's own name carries in the bar above.
                      style={{ '--id': colorForPlayer(state, p.id) }}
                      onPointerDown={() => send({ t: 'act', act: 'duelVote', data: p.id })}
                    >
                      <span class="nom-btn__name">{p.name}</span>
                      <Votes voters={votes} />
                    </button>
                  )
                })}
                {/* The gesture is its own undo, which nobody guesses at — and a
                    vote you cannot take back is one people hesitate to cast. */}
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
