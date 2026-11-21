import { useSecondsLeft } from './useSocket.ts'

export function Countdown({ until, now }: { until: number; now: () => number }) {
  const left = useSecondsLeft(until, now)
  return (
    <p class="board__countdown" data-review-id="board:countdown" data-overlap aria-label={`${left} seconds`}>
      {left}
    </p>
  )
}
