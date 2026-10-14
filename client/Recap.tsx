import { useEffect, useState } from 'preact/hooks'
import type { RecapCard } from '../shared/recap.ts'

/** The slice of `/recap.json` this page reads. */
type Keepsake = {
  date: string
  standings: { key: string; label: string; score: number }[]
  cards: RecapCard[]
}

/**
 * The night's keepsake on a phone, opened from the finale's code. One fetch
 * and no socket: the page is the record of a night that has already happened,
 * so it neither joins the room nor changes with it.
 */
export function Recap() {
  const [night, setNight] = useState<Keepsake | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch('/recap.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setNight, () => setFailed(true))
  }, [])

  if (failed) return <main class="recap"><p class="muted">The recap is not available right now.</p></main>
  if (!night) return <main class="recap" />
  return (
    <main class="recap" data-review-id="recap">
      <p class="recap__date">{night.date}</p>
      {night.cards.length === 0 ? (
        <p class="muted">Nothing to tell yet</p>
      ) : (
        <div class="recap__cards">
          {night.cards.map((c) => (
            <section key={c.id} class="recap__card">
              <p class="recap__title">{c.title}</p>
              <p class="recap__name">{c.name}</p>
              {c.detail && <p class="recap__detail">{c.detail}</p>}
            </section>
          ))}
        </div>
      )}
      <p class="eyebrow">Final standings</p>
      <ol class="stack">
        {night.standings.map((r, i) => (
          <li key={r.key} class="row">
            <span class={i < 3 ? `rank rank--${i + 1}` : 'rank'}>{i < 3 ? ['1st', '2nd', '3rd'][i] : ''}</span>
            <span class="row__label">{r.label}</span>
            <span class="row__score readout">{r.score}</span>
          </li>
        ))}
      </ol>
    </main>
  )
}
