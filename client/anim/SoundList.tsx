/**
 * A list of sounds you can listen to before you commit to one.
 *
 * Both places the panel shows sounds — the holding ground in `sounds/raw/` and
 * the sources a layer may take — are the same act: read a list, hear a few,
 * pick one. They were two different shapes, a row of buttons and a jumble of
 * buttons, and neither let you hear anything without also doing something.
 * Auditioning is the whole job; picking is the end of it.
 *
 * So: one row per sound, transport on the left, name, then its measurement
 * right-aligned. Selecting is a click on the row and nothing else happens —
 * the action that follows is a separate, named button, because "adopt this as
 * a bed" and "add this as a layer" are decisions and a list is not the place
 * to make them by accident.
 *
 * The row is the board's own `.row`, down to the left border that carries
 * state — the same device that marks the leader in the standings. A harness
 * that invented its own list would be a second design system to keep in step.
 */
import { useRef, useState } from 'preact/hooks'

export type SoundRow = {
  /** Stable across renders; also what `selected` and `playing` are compared to. */
  id: string
  name: string
  /** The measurement on the right: a duration, a size. Tabular, dim, secondary. */
  meta?: string
  /** A word for what kind of thing this is, when a list mixes kinds. */
  tag?: string
}

/**
 * One preview at a time, whoever started it.
 *
 * Two sounds at once is not a comparison, it is a chord — and the second click
 * in a list is nearly always "no, the other one", not "both". Starting anything
 * stops what was running, and clicking what is already running stops it.
 *
 * `start` is handed a `done` it should call when the sound ends on its own, and
 * returns the function that cuts it short. `done` is id-checked inside, so a
 * preview finishing late cannot clear the state of the one that replaced it.
 */
export function usePreview() {
  const [playing, setPlaying] = useState('')
  const stopper = useRef<(() => void) | null>(null)

  const stop = () => {
    stopper.current?.()
    stopper.current = null
    setPlaying('')
  }

  const toggle = (id: string, start: (done: () => void) => () => void) => {
    const again = playing === id
    stop()
    if (again) return
    stopper.current = start(() => setPlaying((p) => (p === id ? '' : p)))
    setPlaying(id)
  }

  return { playing, toggle, stop }
}

export function SoundList({
  rows,
  selected,
  onSelect,
  playing,
  onPreview,
  empty,
}: {
  rows: SoundRow[]
  selected: string
  onSelect: (id: string) => void
  playing: string
  onPreview: (id: string) => void
  /** What to say when there is nothing here — an empty list should still direct. */
  empty: string
}) {
  if (rows.length === 0) return <p class="harness__note">{empty}</p>

  return (
    <ul class="stack sndlist">
      {rows.map((r) => (
        <li key={r.id} class={r.id === selected ? 'row sndlist__row is-picked' : 'row sndlist__row'}>
          <button
            class={r.id === playing ? 'sndlist__play is-playing' : 'sndlist__play'}
            title={r.id === playing ? `Stop ${r.name}` : `Play ${r.name}`}
            aria-label={r.id === playing ? `Stop ${r.name}` : `Play ${r.name}`}
            onClick={() => onPreview(r.id)}
          >
            {r.id === playing ? '❙❙' : '▶'}
          </button>
          {/* The name is truncated at the end, and a download's name carries its
              meaning at the end — `512345__someguy__big-buzzer-take2.wav` keeps
              the part you do not need. The full name on hover is the cheap half
              of the fix; renaming it is what Adopt is for. */}
          <button
            class="sndlist__pick"
            title={r.name}
            aria-pressed={r.id === selected}
            onClick={() => onSelect(r.id)}
          >
            {r.name}
          </button>
          {r.tag && <span class="sndlist__tag">{r.tag}</span>}
          {r.meta && <span class="sndlist__meta readout">{r.meta}</span>}
        </li>
      ))}
    </ul>
  )
}
