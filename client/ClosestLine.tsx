import { useEffect, useState } from 'preact/hooks'
import type { ClosestMark, ClosestWall } from '../shared/wall.ts'
import { CLOSEST_REVEAL, closestTimes, formatNumber } from '../shared/closest.ts'
import type { Round } from '../shared/protocol.ts'

const LABEL_BASE = 0.02
const LABEL_CHAR = 0.014
const MAX_LANES = 4

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

export function closestStamp(c: ClosestWall): string {
  const w = c.winners ?? []
  if (!w.length) return 'Nobody'
  const off = w[0].off === 0 ? 'spot on' : `${formatNumber(w[0].off, c.plain)} off`
  const who = w.length > 2 ? `${w.length} tied` : w.map((x) => x.name).join(' & ')
  return `${who} +${w[0].paid}${w.length > 1 ? ' each' : ''} · ${off}`
}

type Group = { marks: ClosestMark[]; at: number; shift: number; span: number; lane: number; start: number }

const shiftAt = (at: number) => Math.min(at / 0.15, 1) * 0.5 + Math.max(0, (at - 0.85) / 0.15) * 0.5

function groups(marks: ClosestMark[]): Group[] {
  const out: Group[] = []
  for (const m of marks) {
    const last = out[out.length - 1]
    if (last && last.marks[0].guess === m.guess) last.marks.push(m)
    else out.push({ marks: [m], at: m.at, shift: shiftAt(m.at), span: 0, lane: 0, start: 0 })
  }
  const placed: Group[] = []
  const covers = (g: Group, x: number) => g.start - 0.004 < x && x < g.start + g.span + 0.004
  for (const g of out) {
    const chars = Math.max(g.marks.map((m) => m.name).join(' · ').length * 0.85, g.marks[0].text.length + 2)
    const face = LABEL_BASE + chars * LABEL_CHAR
    const chip = g.marks[0].place ? LABEL_BASE + (String(g.marks[0].paid).length + 2) * LABEL_CHAR : 0
    g.span = face + chip
    g.start = g.at - g.shift * face - (g.shift === 1 ? chip : 0)
    const overlaps = (lane: number) =>
      placed.filter((p) => p.lane === lane && p.start < g.start + g.span && g.start < p.start + p.span).length
    const hides = (lane: number) =>
      placed.some((p) => (p.lane < lane && covers(p, g.at)) || (p.lane > lane && covers(g, p.at)))
    const lanes = Array.from({ length: MAX_LANES }, (_, l) => l)
    const lane =
      lanes.find((l) => !overlaps(l) && !hides(l)) ??
      lanes.find((l) => !overlaps(l)) ??
      lanes.reduce((best, l) => (overlaps(l) < overlaps(best) ? l : best), 0)
    g.lane = lane
    placed.push(g)
  }
  return out
}

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
                class={`closest__mark ${place === 1 ? 'is-won' : place === 2 ? 'is-second' : 'is-dim'}${g.shift === 0 ? ' is-start' : g.shift === 1 ? ' is-end' : ''}`}
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

function Arrow({ flip = false }: { flip?: boolean }) {
  return (
    <svg class="closest__arrow" viewBox="0 0 10 10" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
    </svg>
  )
}

export function closestStampDelay(c: ClosestWall): string {
  return `${closestTimes(c.marks?.length ?? 0).stampAt}ms`
}
