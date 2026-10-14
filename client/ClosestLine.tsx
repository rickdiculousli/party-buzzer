import { useEffect, useState } from 'preact/hooks'
import type { ClosestMark, ClosestWall } from '../shared/wall.ts'
import { formatNumber } from '../shared/closest.ts'

/** Between one mark landing and the next, so a crowd lands as a patter. */
const LAND_STEP_MS = 90
/** One mark's drop: `--fx-drop-dur` in style.css. */
const DROP_MS = 420
/** The room reads the spread before the answer arrives. */
const HOLD_MS = 1000
/** The answer's run in from the right-hand end. */
const SLIDE_MS = 800
/** A label's share of the line, for keeping two off one spot. */
const LABEL_SPAN = 0.14
const LANES = 4

/**
 * Where a closest reveal is on this screen: the guesses landing (0), the
 * answer sliding in (1), the nearest lit (2). A browser clock, so it lives
 * here and not in `wallOf`; a frozen preview starts at the end.
 */
export type ClosestStage = 0 | 1 | 2

export function useClosestStage(c: ClosestWall | null, questionId: string, instant: boolean): ClosestStage {
  const revealed = c?.truth !== undefined
  const marks = c?.marks?.length ?? 0
  const [stage, setStage] = useState<{ id: string; at: ClosestStage }>({ id: '', at: 0 })
  useEffect(() => {
    if (!revealed) return
    if (instant) {
      setStage({ id: questionId, at: 2 })
      return
    }
    const landed = marks * LAND_STEP_MS + DROP_MS + HOLD_MS
    const slide = setTimeout(() => setStage({ id: questionId, at: 1 }), landed)
    const light = setTimeout(() => setStage({ id: questionId, at: 2 }), landed + SLIDE_MS)
    return () => {
      clearTimeout(slide)
      clearTimeout(light)
    }
    // Once per reveal: a guess cannot change after it.
  }, [revealed, questionId, instant])
  if (!revealed) return 0
  if (instant) return 2
  return stage.id === questionId ? stage.at : 0
}

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
 * line. At the reveal the guesses drop onto the line, the answer slides in
 * from the right, and the nearest lights.
 */
export function ClosestLine({ c, stage, colorOf }: { c: ClosestWall; stage: ClosestStage; colorOf: (id: string) => string }) {
  const revealed = c.truth !== undefined
  const marks = c.marks ?? []
  const lane = lanes(marks)
  return (
    <div class="closest fx-rise" data-review-id="board:closest">
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
          {marks.map((m, i) => {
            const lit = stage === 2 && m.place
            return (
              <li
                key={m.id}
                class={`closest__mark${lit ? ` is-${m.place === 1 ? 'won' : 'second'}` : ''}${stage === 2 && !m.place ? ' is-dim' : ''}`}
                style={{ '--at': m.at, '--lane': lane[i], '--id': colorOf(m.id) }}
              >
                <span class="closest__dot fx-drop" style={{ animationDelay: `${i * LAND_STEP_MS}ms` }} />
                <span class={lit ? 'closest__label fx-tada' : 'closest__label fx-fade'} style={lit ? undefined : { animationDelay: `${i * LAND_STEP_MS}ms` }}>
                  <span class="closest__name">{m.name}</span>
                  <span class="closest__guess">
                    {m.parked === 'low' && '◂ '}
                    {m.text}
                    {m.parked === 'high' && ' ▸'}
                  </span>
                  {lit && <span class="closest__paid">+{m.paid}</span>}
                </span>
              </li>
            )
          })}
        </ol>
        {c.truth && stage > 0 && (
          <p
            class="closest__truth fx-slide"
            data-review-id="board:truth"
            style={{ '--at': c.truth.at, '--fx-from': 1, '--fx-dur': `${SLIDE_MS}ms` }}
          >
            <span class="closest__tick" />
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
