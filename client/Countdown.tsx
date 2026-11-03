import { useSecondsLeft } from './useSocket.ts'

/**
 * The room's window closing — picking, an autoplay buzz window, a Sketch
 * turn: the seconds left, huge and faded behind the wall, so it is felt rather
 * than read and takes no room from the stage.
 */
export function Countdown({ until, now }: { until: number; now: () => number }) {
  const left = useSecondsLeft(until, now)
  return (
    <p class="board__countdown" data-review-id="board:countdown" data-overlap aria-label={`${left} seconds`}>
      {left}
    </p>
  )
}
