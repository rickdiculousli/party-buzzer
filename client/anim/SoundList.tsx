import { useRef, useState } from 'preact/hooks'

export type SoundRow = {
  id: string
  name: string
  meta?: string
  tag?: string
}

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
  empty: string
}) {
  if (rows.length === 0) return <p class="harness__hint">{empty}</p>

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
