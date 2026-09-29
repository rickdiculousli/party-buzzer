import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Card } from '../shared/protocol.ts'
import { pokerCues, type Leg, type PokerView } from './poker.ts'
import { play } from './sound.ts'

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const RANK: Record<string, string> = { T: '10' }

/** One playing card, a paper prop. Face down shows its back; `lift` raises a winning card. */
export function PlayingCard({ card, down = false, class: cls = '' }: { card: Card | null; down?: boolean; class?: string }) {
  if (down || !card) return <span class={`poker-card poker-card--down ${cls}`} aria-label="face-down card" />
  const red = card[1] === 'h' || card[1] === 'd'
  const rank = RANK[card[0]] ?? card[0]
  return <span class={`poker-card ${red ? 'poker-card--red' : ''} ${cls}`} aria-label={`${rank}${SUIT[card[1]]}`}>
    <span class="poker-card__rank">{rank}</span>
    <span class="poker-card__suit">{SUIT[card[1]]}</span>
  </span>
}

/** Plays this surface's cues as frames arrive. `who` is 'board' or the phone's player id. */
export function usePokerCues(frame: PokerView | null, who: string | null) {
  const prev = useRef<PokerView | null>(null)
  useEffect(() => {
    if (!frame || !who) return
    for (const { cue } of pokerCues(prev.current, frame, who)) play(cue)
    prev.current = frame
  }, [frame, who])
}

/** A ring that empties as a shot clock runs down; the last seconds beat. */
export function ShotRing({ until, total, now, class: cls = '' }: { until: number; total: number; now: number; class?: string }) {
  const left = Math.max(0, until - now)
  const share = Math.min(1, left / total)
  const r = 45
  const around = 2 * Math.PI * r
  return <svg class={`poker-ring ${left <= 5_000 ? 'fx-heartbeat' : ''} ${cls}`} viewBox="0 0 100 100" aria-label={`${Math.ceil(left / 1000)} seconds to act`}>
    <circle class="poker-ring__track" cx="50" cy="50" r={r} />
    <circle class="poker-ring__left" cx="50" cy="50" r={r} style={{ strokeDasharray: around, strokeDashoffset: around * (1 - share) }} />
  </svg>
}

/**
 * Something crossing the felt: it starts at `from` and runs `legs` in turn,
 * moving by transform only, then calls `done`. Coordinates are 0–1 of the table.
 */
export function Flight({ from, legs, easing, children, done }: {
  from: { x: number; y: number }; legs: Leg[]; easing: string; children: ComponentChildren; done: () => void
}) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    const table = node?.parentElement?.getBoundingClientRect()
    if (!node || !table) return done()
    const total = legs.reduce((sum, leg) => sum + leg.ms, 0)
    let at = 0
    const frames: Keyframe[] = [{ transform: 'translate(0px, 0px) rotate(0deg)', offset: 0, easing }]
    for (const leg of legs) {
      at += leg.ms
      frames.push({
        transform: `translate(${(leg.at.x - from.x) * table.width}px, ${(leg.at.y - from.y) * table.height}px) rotate(${leg.at.rotate}deg)`,
        offset: at / total,
        easing,
      })
    }
    const run = node.animate(frames, { duration: total, fill: 'forwards' })
    run.onfinish = done
    return () => run.cancel()
  }, [])
  return <div ref={el} class="poker-flight" style={{ left: `${from.x * 100}%`, top: `${from.y * 100}%` }}>{children}</div>
}
