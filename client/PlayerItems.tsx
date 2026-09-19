import { useState } from 'preact/hooks'
import type { ClientMsg, State } from '../shared/protocol.ts'
import { Burst } from './fx.tsx'

// Mirror of server/items.ts — ids, display names, targeting. The wire carries
// only ids, and three items do not justify a catalog channel.
const ITEM_INFO: Record<string, { name: string; opponent: boolean; passive?: boolean }> = {
  freeze: { name: 'Freeze', opponent: true },
  shield: { name: 'Shield', opponent: false, passive: true },
  steal: { name: 'Steal', opponent: false },
}

/**
 * What this phone is holding, and the two taps that spend it. Targeting is the
 * only local state on the surface that the server does not own — a half-made
 * choice between "which item" and "at whom", which is nobody else's business
 * until it is fired.
 */
export function PlayerItems({
  state,
  playerId,
  send,
}: {
  state: State
  playerId: string | null
  send: (m: ClientMsg) => void
}) {
  const [targetFor, setTargetFor] = useState<string | null>(null)

  const myItems = playerId ? (state.items[playerId] ?? []) : []
  const itemCounts = [...myItems.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())]
  const opponents = state.players.filter((p) => p.id !== playerId && p.connected)

  // A used item leaves a ghost that poofs out, so spending one is seen even
  // though the server takes it away on the next broadcast.
  // ponytail: the ghost sits at the end of the row, not where the button was.
  // Overlay it on the button's rect if that reads wrong.
  const [gone, setGone] = useState<{ key: number; name: string }[]>([])

  const fireItem = (itemId: string, targetId?: string) => {
    send({ t: 'act', act: 'useItem', data: { itemId, targetId } })
    setTargetFor(null)
    setGone((g) => [...g, { key: performance.now(), name: ITEM_INFO[itemId]?.name ?? itemId }])
  }

  if (itemCounts.length === 0 && gone.length === 0) return null

  return (
    <div class="player__items">
      {targetFor ? (
        <>
          <span class="muted">Pick a target</span>
          {opponents.map((p) => (
            <button key={p.id} class="btn" onPointerDown={() => fireItem(targetFor, p.id)}>
              {p.name}
            </button>
          ))}
          <button class="btn btn--ghost" onPointerDown={() => setTargetFor(null)}>
            Cancel
          </button>
        </>
      ) : (
        itemCounts.map(([id, n]) => {
          const info = ITEM_INFO[id]
          if (!info) return null
          const count = n > 1 ? ` ×${n}` : ''
          // Passive items (shield) show as chips: held, never fired by hand.
          // Keyed on the count, so a newly held one pops in.
          if (info.passive) return <span key={`${id}:${n}`} class="chip chip--data fx-pop">{info.name}{count}</span>
          return (
            <button
              key={`${id}:${n}`}
              class="btn fx-pop fx-anchor"
              onPointerDown={() => (info.opponent ? setTargetFor(id) : fireItem(id))}
            >
              {info.name}{count}
              <Burst kind="sparkle" from="edge" />
            </button>
          )
        })
      )}
      {gone.map((g) => (
        <span
          key={g.key}
          class="btn fx-poof"
          aria-hidden="true"
          onAnimationEnd={() => setGone((x) => x.filter((y) => y.key !== g.key))}
        >
          {g.name}
        </span>
      ))}
    </div>
  )
}
