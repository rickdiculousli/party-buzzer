import type { PlayerId } from '../shared/protocol.ts'

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
