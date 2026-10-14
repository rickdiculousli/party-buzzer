import { useEffect, useState } from 'preact/hooks'
import type { ClosestMark, ClosestWall } from '../shared/wall.ts'
import { CLOSEST_REVEAL, closestTimes, formatNumber } from '../shared/closest.ts'
import type { Round } from '../shared/protocol.ts'

/** A label's width along the line: a margin plus this much per character. Labels scale with the board's width, so the share holds. */
const LABEL_BASE = 0.02
const LABEL_CHAR = 0.014
/** Past this many lanes the line would push the band off a short wall; a crowd that big shares lanes. */
const MAX_LANES = 4

/**
 * True while a settled closest question's reveal is still playing on the
 * board: phones keep their "Locked" and the standings keep the old scores
 * until it is done, so nobody learns the result before the wall shows it.
 * A browser clock, so it lives here and not in `wallOf`.
 */
export function useClosestHold(round: Round | undefined, active: boolean): boolean {
  const key = active && round?.kind === 'closest' && round.truth !== undefined ? round.questionId : ''
  const [doneFor, setDoneFor] = useState('')
  const ms = closestTimes(round?.guessed ?? 0).doneAt
  useEffect(() => {
    if (!key) return
    const t = setTimeout(() => setDoneFor(key), ms)
    return () => clearTimeout(t)
  }, [key])
  return !!key && doneFor !== key
}

/** The stamp above the line once the nearest is lit: "Ed +200 · 15 off". */
export function closestStamp(c: ClosestWall): string {
  const w = c.winners ?? []
  if (!w.length) return 'Nobody'
  const off = w[0].off === 0 ? 'spot on' : `${formatNumber(w[0].off, c.plain)} off`
  const who = w.length > 2 ? `${w.length} tied` : w.map((x) => x.name).join(' & ')
  return `${who} +${w[0].paid}${w.length > 1 ? ' each' : ''} · ${off}`
}

/** Guesses of the same number share one label: two names, one number. */
type Group = { marks: ClosestMark[]; at: number; shift: number; span: number; lane: number }

/**
 * How far a label sits left of its dot, as a share of its own width: centred,
 * except near the ends of the line, where it slides to stay on the line.
 */
const shiftAt = (at: number) => Math.min(at / 0.15, 1) * 0.5 + Math.max(0, (at - 0.85) / 0.15) * 0.5

/** Lanes above the line, lowest first, so labels near each other stack rather than overprint. */
function groups(marks: ClosestMark[]): Group[] {
  const out: Group[] = []
  for (const m of marks) {
    const last = out[out.length - 1]
    if (last && last.marks[0].guess === m.guess) last.marks.push(m)
    else out.push({ marks: [m], at: m.at, shift: shiftAt(m.at), span: 0, lane: 0 })
  }
  const ends: number[] = []
  for (const g of out) {
    const chars = Math.max(g.marks.map((m) => m.name).join(' · ').length * 0.85, g.marks[0].text.length + (g.marks[0].paid ? 5 : 0) + 2)
    g.span = LABEL_BASE + chars * LABEL_CHAR
    const start = g.at - g.shift * g.span
    let lane = ends.findIndex((end) => end <= start)
    if (lane < 0) lane = ends.length < MAX_LANES ? ends.length : ends.indexOf(Math.min(...ends))
    ends[lane] = start + g.span
    g.lane = lane
  }
  return out
}

/**
 * A closest question in the band below the clue. While the room guesses, a
 * slot per player fills in their colour, never their number, over an empty
 * line. At the reveal the guesses drop onto the line one after another, it
 * holds, the answer runs in from the right, the nearest lights, then the
 * stamp. Those are CSS delays set here from `closestTimes`, the one schedule
 * the phones and the reader also keep, so the board needs no clock for them.
 */
export function ClosestLine({ c, closed, colorOf }: { c: ClosestWall; closed: boolean; colorOf: (id: string) => string }) {
  const revealed = c.truth !== undefined
  const marks = c.marks ?? []
  const lined = groups(marks)
  const t = closestTimes(marks.length)
  const r = CLOSEST_REVEAL
  const ms = (n: number) => `${n}ms`
  let i = 0
  return (
    <div
      class="closest fx-rise"
      data-review-id="board:closest"
      style={{ '--lanes': Math.max(3, ...lined.map((g) => g.lane + 1)), '--light-at': ms(t.lightAt) }}
    >
      {/* Everyone in, or time up: the bar warms for the beat before the answer, as a choice question's does. */}
      <div class={revealed ? 'board__status-row is-gone' : 'board__status-row'}>
        <ol class={closed ? 'board__slots is-closed fx-ripple' : 'board__slots'} data-review-id="board:guessers">
          {c.guessers.map((g, k) => (
            <li key={k} class="board__slot">
              {g.guessed && <span key={g.id} class="board__dot fx-pop" style={{ '--id': colorOf(g.id) }} />}
            </li>
          ))}
        </ol>
      </div>
      <div class="closest__line" data-review-id="board:line">
        {!revealed && <p class="closest__ask">{c.unit ? `Guess in ${c.unit}` : 'Guess a number'}</p>}
        <ol class="closest__marks">
          {lined.map((g) => {
            const first = g.marks[0]
            const place = first.place
            const landAt = i * r.landStepMs
            const dots = g.marks.map((m) => (
              <span
                key={m.id}
                class="closest__dot fx-drop"
                data-overlap
                style={{ '--id': colorOf(m.id), '--fx-dur': ms(r.dropMs), animationDelay: ms(i++ * r.landStepMs) }}
              />
            ))
            return (
              <li
                key={first.id}
                class={`closest__mark ${place === 1 ? 'is-won' : place === 2 ? 'is-second' : 'is-dim'}`}
                style={{ '--at': g.at, '--lane': g.lane, '--shift': g.shift, '--id': colorOf(first.id), '--land-at': ms(landAt + r.dropMs / 2) }}
              >
                {dots}
                <span class="closest__label">
                  <span class="closest__box fx-tada" style={place === 1 ? { '--fx-dur': ms(r.tadaMs), animationDelay: ms(t.lightAt) } : { animation: 'none' }}>
                    <span class="closest__face">
                      <span class="closest__names">
                        {g.marks.map((m, k) => (
                          <span key={m.id} class="closest__name" style={{ '--id': colorOf(m.id) }}>
                            {k > 0 && ' · '}
                            {m.name}
                          </span>
                        ))}
                      </span>
                      <span class="closest__guess">
                        {first.parked === 'low' && <Arrow flip />}
                        {first.text}
                        {first.parked === 'high' && <Arrow />}
                        {!!place && <span class="closest__paid"> +{first.paid}</span>}
                      </span>
                    </span>
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
        {c.truth && (
          <p
            class="closest__truth fx-slide fx-slide--even"
            data-review-id="board:truth"
            style={{ '--at': c.truth.at, '--shift': shiftAt(c.truth.at), '--fx-from': 1, '--fx-dur': ms(r.slideMs), animationDelay: ms(t.truthAt) }}
          >
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

/** A parked guess's pointer off the end of the line. Drawn, because the display face has no arrows. */
function Arrow({ flip = false }: { flip?: boolean }) {
  return (
    <svg class="closest__arrow" viewBox="0 0 10 10" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
    </svg>
  )
}

/** The stamp's delay: after the nearest has lit and begun its tada. */
export function closestStampDelay(c: ClosestWall): string {
  return `${closestTimes(c.marks?.length ?? 0).stampAt}ms`
}
