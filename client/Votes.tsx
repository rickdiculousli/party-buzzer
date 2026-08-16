import type { PlayerId } from '../shared/protocol.ts'

/**
 * A vote tally drawn as the people who cast it.
 *
 * Everywhere else a number on this board is a measurement — milliseconds, a
 * score, a value — and the palette says measurement in cyan. A nomination is
 * not a measurement, it is the room making up its mind, so it gets counted the
 * way a room counts: heads. Four silhouettes read as "more than that one" from
 * ten feet without anybody reading a digit, and the crowd growing one figure at
 * a time is the whole reason the window is open for a few seconds instead of
 * resolving instantly.
 *
 * Keyed by voter, not by index. That is what makes the arriving vote the
 * element that mounts — so the flare fires on the new figure — and what keeps
 * the survivors still when someone takes a vote back.
 */
export function Votes({ voters }: { voters: PlayerId[] }) {
  if (voters.length === 0) return null
  return (
    <span class="votes" aria-label={`${voters.length} ${voters.length === 1 ? 'vote' : 'votes'}`}>
      {voters.map((id) => (
        <span key={id} class="vote" aria-hidden="true">
          {'\u{1F464}'}
        </span>
      ))}
    </span>
  )
}
