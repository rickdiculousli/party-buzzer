import type { ClosestMark, ClosestWall } from '../shared/wall.ts'
import { formatNumber } from '../shared/closest.ts'

/** A label's share of the line, for keeping two off one spot. */
const LABEL_SPAN = 0.14
const LANES = 4

/** The stamp above the line once the nearest is lit: "+200 · 35 off". */
export function closestStamp(c: ClosestWall): string {
  const w = c.winners ?? []
  if (!w.length) return 'Nobody'
  const off = w[0].off === 0 ? 'spot on' : `${formatNumber(w[0].off)} off`
  return `+${w[0].paid}${w.length > 1 ? ' each' : ''} · ${off}`
}

/**
 * Lanes above the line, lowest first, so labels near each other stack rather
 * than overprint. Each label is shifted left by its own position along the
 * line, so the ends stay inside it; the span here follows that.
 */
function lanes(marks: ClosestMark[]): number[] {
  const ends = new Array<number>(LANES).fill(-Infinity)
  return marks.map((m) => {
    const start = m.at - m.at * LABEL_SPAN
    let lane = ends.findIndex((end) => end <= start)
    if (lane < 0) lane = ends.indexOf(Math.min(...ends))
    ends[lane] = start + LABEL_SPAN
    return lane
  })
}

/**
 * A closest question in the band below the clue. While the room guesses, a
 * slot per player fills in their colour, never their number, over an empty
 * line. At the reveal the guesses drop onto the line one after another, it
 * holds, the answer slides in from the right, and the nearest lights. That
 * sequence is all CSS delays from `--closest-n` (style.css, the closest
 * tunables), so the board needs no clock for it and the harness can drive it.
 */
export function ClosestLine({ c, colorOf }: { c: ClosestWall; colorOf: (id: string) => string }) {
  const revealed = c.truth !== undefined
  const marks = c.marks ?? []
  const lane = lanes(marks)
  return (
    <div class="closest fx-rise" data-review-id="board:closest" style={{ '--closest-n': marks.length }}>
      <div class={revealed ? 'board__status-row is-gone' : 'board__status-row'}>
        <ol class="board__slots" data-review-id="board:guessers">
          {c.guessers.map((g, i) => (
            <li key={i} class="board__slot">
              {g.guessed && <span key={g.id} class="board__dot fx-pop" style={{ '--id': colorOf(g.id) }} />}
            </li>
          ))}
        </ol>
      </div>
      <div class="closest__line" data-review-id="board:line">
        {!revealed && <p class="closest__ask">{c.unit ? `Guess in ${c.unit}` : 'Guess a number'}</p>}
        <ol class="closest__marks">
          {marks.map((m, i) => (
            <li
              key={m.id}
              class={`closest__mark ${m.place === 1 ? 'is-won' : m.place === 2 ? 'is-second' : 'is-dim'}`}
              style={{ '--at': m.at, '--lane': lane[i], '--i': i, '--id': colorOf(m.id) }}
            >
              {/* Guesses close together share a spot on the line. */}
              <span class="closest__dot fx-drop" data-overlap />
              <span class="closest__label">
                <span class="closest__name">{m.name}</span>
                <span class="closest__guess">
                  {m.parked === 'low' && '◂ '}
                  {m.text}
                  {m.parked === 'high' && ' ▸'}
                </span>
                {!!m.place && <span class="closest__paid">+{m.paid}</span>}
              </span>
            </li>
          ))}
        </ol>
        {c.truth && (
          <p class="closest__truth fx-slide" data-review-id="board:truth" style={{ '--at': c.truth.at, '--fx-from': 1 }}>
            <span class="closest__tick" data-overlap />
            <span class="closest__value">
              {c.truth.text}
              {c.unit && <span class="closest__unit"> {c.unit}</span>}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
