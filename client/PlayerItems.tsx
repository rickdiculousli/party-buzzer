import { useState } from 'preact/hooks'
import type { ClientMsg, State } from '../shared/protocol.ts'
import { Burst } from './fx.tsx'

const ITEM_INFO: Record<string, { name: string; opponent: boolean; passive?: boolean }> = {
  freeze: { name: 'Freeze', opponent: true },
  shield: { name: 'Shield', opponent: false, passive: true },
  steal: { name: 'Steal', opponent: false },
}

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
