import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import type { RefObject } from 'preact'
import { useFinale, useOpen, useSocket, type SocketFixture } from './useSocket.ts'
import { colorForPlayer, lockedNames, ordinal, setlistPosition, standings, willSeat, type Standing } from './ui.ts'
import { markGap, play, playSpaced, prime, startBed, stopBed, unlock } from './sound.ts'
import { Votes } from './Votes.tsx'
import { Spoken } from './Spoken.tsx'
import { lastUp, wallOf, type ChoiceWall, type FinaleStep, type RevealWall, type Tier, type Wall } from '../shared/wall.ts'
import { LETTERS } from '../shared/choice.ts'
import { recapCards, type RecapCard } from '../shared/recap.ts'
import { isPenalty } from '../shared/protocol.ts'
import { useReveal } from './useReveal.ts'
import { COLLECT_MS, QUIZ_REACT_LABEL, type BuzzEntry, type State } from '../shared/protocol.ts'
import { MINIGAMES } from './minigames.tsx'
import { joinShown } from './minigame-info.ts'
import { JoinCode } from './JoinCode.tsx'
import { ArrivalBoard } from './ArrivalBoard.tsx'
import { practiceLobbyId } from './arrival-feedback.ts'
import { useLitTime, usePracticeTime } from './usePractice.ts'
import { LIFTS, PILL_CAP, PILL_FADE_MS, PILL_MS, freshReactions, shownPills, type Pill } from './reactions.ts'
import { Burst, Letters, ScoreChange, useFlip } from './fx.tsx'
import { Countdown } from './Countdown.tsx'
import { ClosestLine, closestStamp, closestStampDelay, useClosestHold } from './ClosestLine.tsx'
import { allGuessed, scoresBeforeClosest } from '../shared/closest.ts'
import { RevealPicture, RevealStakes } from './RevealPicture.tsx'

type Mark = BuzzEntry & { lane: number }

function Hero({ name, tone }: NonNullable<Wall['hero']>) {
  return (
    <p
      data-review-id="board:hero"
      key={name}
      class={`board__hero board__hero--toned fx-anchor${tone === 'answering' ? '' : ` is-${tone}`}`}
    >
      <span key={tone} class="board__hero-tone">
        {tone === 'penalised' ? <span class="board__hero-hit fx-shake">{name}</span> : name}
      </span>
    </p>
  )
}

export function Finale({ tiers, step, elapsedMs, cards = [] }: { tiers: Tier[]; step: FinaleStep; elapsedMs: number; cards?: RecapCard[] }) {
  const [settled] = useState(step === 1)
  const [delay] = useState(-elapsedMs)
  if (step === 'build') return <span class="board__finale-flash" aria-hidden="true" style={{ animationDelay: `${delay}ms` }} />
  const tier = tiers.find((t) => t.place === step)
  if (step !== 1) return tier ? <Podium key={step} tier={tier} /> : null
  return <FinaleShow names={tier?.names ?? []} cards={cards} settled={settled} />
}

function Podium({ tier }: { tier: Tier }) {
  return (
    <p class={`board__finale-step rank--${tier.place} fx-anchor`} data-review-id="board:podium">
      <span class={`rank rank--${tier.place} board__finale-place fx-pop`}>{ordinal(tier.place)}</span>
      <span class="board__hero board__hero--toned board__finale-name">
        <span class="board__hero-tone">{tier.names.join(' & ')}</span>
      </span>
      <span class="board__finale-score readout fx-rise">{tier.score}</span>
    </p>
  )
}

const RECAP_START_MS = 2500
const RECAP_CARD_MS = 4000

function RecapBand({ cards, settled }: { cards: RecapCard[]; settled: boolean }) {
  const [started, setStarted] = useState(settled)
  const [i, setI] = useState(0)
  useEffect(() => {
    if (settled) return
    const t = setTimeout(() => setStarted(true), RECAP_START_MS)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (!started || cards.length < 2) return
    const t = setInterval(() => setI((n) => n + 1), RECAP_CARD_MS)
    return () => clearInterval(t)
  }, [started, cards.length])
  const card = started ? cards[i % cards.length] : undefined
  if (!card) return null
  return (
    <div class="board__recap" data-review-id="board:recap">
      <div key={card.id} class="board__recap-card fx-rise">
        <p class="board__recap-title">{card.title}</p>
        <p class="board__recap-name">{card.name}</p>
        {card.detail && <p class="board__recap-detail">{card.detail}</p>}
      </div>
    </div>
  )
}

function FinaleShow({ names, cards, settled }: { names: string[]; cards: RecapCard[]; settled: boolean }) {
  const [again, setAgain] = useState(false)
  const name = useRef<HTMLParagraphElement>(null)
  const [wall, setWall] = useState<Element | null>(null)
  useEffect(() => {
    setWall(name.current?.closest('.board__wall') ?? null)
    if (settled) return
    const t = setTimeout(() => setAgain(true), 1200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div class="board__finale-stack">
      <p ref={name} class={`board__hero board__finale fx-anchor${settled ? ' is-settled' : ''}`} data-review-id="board:finale">
        <Letters text={names.join(' & ')} class="fx-rainbow" />
        {!settled && <Burst kind="confetti" from="top" />}
        {again && <Burst kind="confetti" from="top" />}
        {wall && !settled && createPortal(<Cannons />, wall)}
      </p>
      {cards.length > 0 && <RecapBand cards={cards} settled={settled} />}
    </div>
  )
}

function Cannons() {
  const [again, setAgain] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAgain(true), 1200)
    return () => clearTimeout(t)
  }, [])
  const volley = (
    <>
      <Burst kind="confetti" count={30} from="left" angle={-50} spread={30} />
      <Burst kind="confetti" count={30} from="right" angle={-130} spread={30} />
    </>
  )
  return (
    <span class="board__cannons" aria-hidden="true">
      {volley}
      {again && volley}
    </span>
  )
}

export function FaceOff({ pair }: { pair: [string, string] }) {
  return (
    <p class="board__faceoff">
      <Charger key={pair[0]} name={pair[0]} from={-1} />
      <span class="board__idle board__vs fx-pop">vs</span>
      <Charger key={pair[1]} name={pair[1]} from={1} />
    </p>
  )
}

function Charger({ name, from }: { name: string; from: number }) {
  const [landed, setLanded] = useState(false)
  return (
    <span
      class="board__hero board__charger fx-slide fx-slide--charge fx-anchor"
      style={{ '--fx-from': from }}
      onAnimationEnd={(e) => e.target === e.currentTarget && setLanded(true)}
    >
      {name}
      {landed && <Burst kind="dust" count={16} from="bottom" />}
    </span>
  )
}

function Said({ text }: { text: string }) {
  const cuts = useRef<number[]>([])
  if (text.length < (cuts.current[cuts.current.length - 1] ?? 0)) cuts.current = []
  if (text.length > (cuts.current[cuts.current.length - 1] ?? 0)) cuts.current = [...cuts.current, text.length]
  let at = 0
  return (
    <>
      {cuts.current.map((end) => {
        const piece = <span key={at} class="fx-fade">{text.slice(at, end)}</span>
        at = end
        return piece
      })}
    </>
  )
}

function Held({ class: cls }: { class: string }) {
  return <p class={cls} style={{ visibility: 'hidden' }} aria-hidden="true">{'\u00a0'}</p>
}

const CALL_TEXT: Record<NonNullable<Wall['call']>, string> = {
  buzz: 'Buzz',
  ready: 'Ready',
  dead: 'Both missed — waiting for the host',
}

function labelWidth(name: string): number {
  const rem = Math.max(5.5, name.length * 1.5)
  return (rem / 58) * 100
}

function lay(entries: BuzzEntry[], width: number): Mark[] {
  const rowEnd: number[] = []
  return entries
    .slice()
    .sort((a, b) => a.deltaMs - b.deltaMs)
    .map((e) => {
      const at = (e.deltaMs / width) * 100
      const half = labelWidth(e.name) / 2
      let lane = rowEnd.findIndex((end) => at - half >= end)
      if (lane === -1) lane = rowEnd.length
      rowEnd[lane] = at + half + 1.5
      return { ...e, lane }
    })
}

const rowsOf = (order: BuzzEntry[]) => Math.max(0, ...lay(order, COLLECT_MS).map((m) => m.lane)) + 1

function roomUnder(wall: HTMLElement): number | null {
  let low: number | null = null
  for (const m of wall.querySelectorAll<HTMLElement>('.timeline__mark')) {
    let y = m.offsetTop + m.offsetHeight
    for (let e = m.offsetParent as HTMLElement | null; e && e !== wall; e = e.offsetParent as HTMLElement | null) y += e.offsetTop
    low = Math.max(low ?? y, y)
  }
  return low === null ? null : wall.clientHeight - low
}

type Placed = { mode: 'high' | 'low'; under: number | null; cleared?: true }
const RANK = { none: 0, low: 1, high: 2 }

function Reactions({ state, reacted, rows, lockouts, now, frozen }: {
  state: State
  reacted: { pills: Pill[]; more: number }
  rows: number
  lockouts: boolean
  now: number
  frozen: boolean
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<{ under: number | null; mode: 'high' | 'low' | 'none' }>()
  useLayoutEffect(() => {
    const el = layer.current
    const wall = el?.parentElement
    if (!el || !wall) return
    const measure = () => {
      const under = roomUnder(wall)
      const need = (name: string) => parseFloat(getComputedStyle(el).getPropertyValue(name))
      const mode = under === null || under >= need('--pill-high') ? 'high' : !lockouts && under >= need('--pill-low') ? 'low' : 'none'
      setRoom((r) => (r?.under === under && r.mode === mode ? r : { under, mode }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(wall)
    return () => watch.disconnect()
  }, [rows, lockouts])
  const fate = useRef(new Map<number, Placed | 'count'>())
  const chipAt = useRef<number | undefined>(undefined)
  const empty = <div ref={layer} class="board__pills" />
  if (reacted.pills.length === 0 && reacted.more === 0) {
    fate.current.clear()
    chipAt.current = undefined
    return empty
  }
  if (!room) return empty
  for (const p of reacted.pills) {
    if (!fate.current.has(p.seq)) fate.current.set(p.seq, room.mode === 'none' ? 'count' : { mode: room.mode, under: room.under })
    const f = fate.current.get(p.seq)!
    if (f === 'count' || f.cleared) continue
    if (RANK[room.mode] < RANK[f.mode]) f.cleared = true
    else if (f.mode === 'high') f.under = room.under
  }
  const pills = reacted.pills.flatMap((p) => {
    const f = fate.current.get(p.seq)!
    return f === 'count' ? [] : [{ ...p, f }]
  })
  const more = reacted.more + reacted.pills.length - pills.length
  if (more > 0 && chipAt.current === undefined) chipAt.current = now
  if (more === 0) chipAt.current = undefined
  const newest = Math.max(...reacted.pills.map((p) => p.at))
  const fadeIn = Math.max(0, newest + PILL_MS - PILL_FADE_MS - (chipAt.current ?? now))
  const latest = reacted.pills[reacted.pills.length - 1]
  return (
    <div
      ref={layer}
      class={frozen ? 'board__pills is-frozen' : 'board__pills'}
      data-review-id="board:reactions"
      style={{ '--cols': PILL_CAP }}
    >
      {pills.map((p) => (
        <span
          key={p.seq}
          class={`board__pill-slot fx-fade fx-fade--out${p.f.mode === 'low' ? ' is-low' : ''}${p.f.cleared ? ' is-cleared' : ''}`}
          style={{ '--col': p.col, '--lift': rows > 1 ? 1 : LIFTS[p.col], '--under': p.f.under === null ? undefined : `${p.f.under}px` }}
        >
          <span class="board__pill fx-rise" style={{ '--id': colorForPlayer(state, p.playerId) }}>{QUIZ_REACT_LABEL[p.kind]}</span>
        </span>
      ))}
      {more > 0 && (
        <span class="board__pills-more-slot fx-fade fx-fade--out" style={{ '--fx-delay': `${fadeIn}ms` }}>
          <span class="chip board__pills-more fx-fade">{pills.length === 0 && latest ? `${QUIZ_REACT_LABEL[latest.kind]} ` : ''}+{more}</span>
        </span>
      )}
    </div>
  )
}

function Timeline({
  state,
  round,
  enter,
}: {
  state: State
  round: State['round']
  enter: Map<string, number>
}) {
  const marks = lay(round.order, COLLECT_MS)
  const lanes = rowsOf(round.order)

  return (
    <div class="timeline" data-review-id="board:timeline">
      <div class="timeline__scale">
        <span>0 ms</span>
        <span>{COLLECT_MS} ms</span>
      </div>
      <div class="timeline__rail" />
      <ol class="timeline__marks" style={{ '--lanes': lanes }}>
        {marks.map((b) => (
          <li
            key={b.playerId}
            class="timeline__mark"
            style={{
              '--at': `${Math.min(100, (b.deltaMs / COLLECT_MS) * 100)}%`,
              '--lane': b.lane,
              '--id': colorForPlayer(state, b.playerId),
              '--enter': `${enter.get(b.playerId) ?? 0}ms`,
            }}
          >
            <span class="timeline__pin" />
            <span class="timeline__name">{b.name}</span>
            <span class="timeline__ms readout">
              {b.deltaMs === 0 ? '' : `+${b.deltaMs}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function NomList({
  state,
  entries,
  seating,
}: {
  state: State
  entries: NonNullable<State['duel']>['pool']
  seating: string[] | null
}) {
  const list = useRef<HTMLOListElement>(null)
  useFlip(list)
  const rank = entries
    .slice()
    .sort((a, b) => b.votes.length - a.votes.length)
    .map((e) => e.playerId)
  return (
    <ol class="board__pool" ref={list}>
      {entries.map((e) => (
        <li
          key={e.playerId}
          data-key={e.playerId}
          class={seating?.includes(e.playerId) ? 'nom is-lead' : 'nom'}
          style={{ order: rank.indexOf(e.playerId) }}
        >
          <span class="nom__name">
            {state.players.find((p) => p.id === e.playerId)?.name ?? '?'}
          </span>
          {e.in && <span class="chip chip--armed">In</span>}
          <Votes voters={e.votes} />
        </li>
      ))}
    </ol>
  )
}

function Choices({ c, now, colorOf }: { c: ChoiceWall; now: () => number; colorOf: (id: string) => string }) {
  const revealed = c.correct !== undefined
  const closed = !revealed && (c.pickers.every((p) => p.picked) || (c.closesAt !== undefined && now() >= c.closesAt))
  return (
    <div class="board__choices fx-rise" data-review-id="board:choices">
      <div class={revealed ? 'board__status-row is-gone' : 'board__status-row'}>
        <ol class={closed ? 'board__slots is-closed fx-ripple' : 'board__slots'} data-review-id="board:pickers">
          {c.pickers.map((p, i) => (
            <li key={i} class="board__slot">
              {p.picked && <span key={p.id} class="board__dot fx-pop" style={{ '--id': colorOf(p.id) }} />}
            </li>
          ))}
        </ol>
      </div>
      <ol class="board__grid">
          {c.options.map((o, i) => (
            <li
              key={i}
              class={!revealed ? 'board__choice' : i === c.correct ? 'board__choice is-right fx-tada' : 'board__choice is-dim'}
            >
              {revealed && !!c.by?.[i]?.length && (
                <span class="board__who" data-overlap>
                  {c.by[i].map((id) => (
                    <span key={id} class="board__dot fx-pop" style={{ '--id': colorOf(id) }} />
                  ))}
                </span>
              )}
              <div class="choice__cell">
                <span class="choice__letter">{LETTERS[i]}</span>
                <span class="choice__option">{o}</span>
              </div>
            </li>
          ))}
      </ol>
    </div>
  )
}

function Question({ whole, shown, image, reveal, now }: { whole?: string; shown: string; image?: string; reveal: RevealWall | null; now: () => number }) {
  const text = !whole ? (
    <p class="board__question" data-review-id="board:question"><Said text={shown} /></p>
  ) : (
    <p class="board__question" data-review-id="board:question">
      <Said text={whole.slice(0, shown.length)} />
      <span class="board__unsaid">{whole.slice(shown.length)}</span>
    </p>
  )
  if (!image) return text
  return (
    <>
      {reveal ? <RevealPicture src={image} reveal={reveal} now={now} /> : <img class="board__image" src={image} alt="" />}
      {text}
    </>
  )
}

export type BoardPreview = {
  socket: SocketFixture
  practiceNow?: number
  open: boolean
  settled: boolean
  retired: boolean
}

const MATCH_HOLD_MS = 1000

function useMatchHold(state: State | null, shown: State['scores'], active: boolean): State['scores'] {
  const seen = useRef<State['scores']>()
  const held = useRef<{ match: string; scores: State['scores'] }>()
  const [doneFor, setDoneFor] = useState('')
  if (state?.minigame && seen.current) held.current = { match: state.minigame.matchId, scores: seen.current }
  const key = active && state && !state.minigame ? held.current?.match ?? '' : ''
  useEffect(() => {
    if (!key) return
    const t = setTimeout(() => setDoneFor(key), MATCH_HOLD_MS)
    return () => clearTimeout(t)
  }, [key])
  const scores = key && doneFor !== key ? held.current!.scores : shown
  if (state && !state.minigame) seen.current = scores
  return scores
}

export function Standings({ rows, list }: { rows: Standing[]; list: RefObject<HTMLOListElement> }) {
  const popped = useRef(new Set<string>())
  return (
    <ol class="stack" ref={list}>
      {rows.map((r, i) => (
        <li
          key={r.key}
          data-key={r.key}
          data-review-id={`board:standing:${r.key}`}
          class={`row${popped.current.has(r.key) ? '' : ' fx-pop'}${r.away ? ' is-away' : ''}`}
          style={{ '--id': r.color }}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget && e.animationName === 'fx-pop') popped.current.add(r.key) }}
        >
          <span class={i < 3 ? `rank rank--${i + 1}` : 'rank'}>
            {i < 3 ? ['1st', '2nd', '3rd'][i] : ''}
          </span>
          <span class="row__label">{r.label}</span>
          {r.away && <span class="chip chip--away">away</span>}
          <ScoreChange class="row__score readout" score={r.score} />
        </li>
      ))}
    </ol>
  )
}

export function Board({ preview }: { preview?: BoardPreview } = {}) {
  const { state, now, connected, minigameFrame, minigameTouches, practice, reactions } = useSocket('board', preview?.socket)
  const pulseNow = usePracticeTime(practice, practiceLobbyId(state), preview?.practiceNow)
  const pillNow = useLitTime(freshReactions(reactions, preview?.practiceNow ?? performance.now()).length > 0, preview?.practiceNow)
  const reacted = shownPills(reactions, state?.round.questionId, pillNow)
  const opening = useOpen(state?.round, now, undefined, !preview)
  const open = preview?.open ?? opening.open

  const [audible, setAudible] = useState(!!preview)
  useEffect(() => {
    if (preview) return
    const go = () => {
      unlock()
      prime('stamp', 'leader', 'award', 'penalty')
      setAudible(true)
    }
    document.addEventListener('pointerdown', go, { once: true })
    return () => document.removeEventListener('pointerdown', go)
  }, [preview])

  const welcoming =
    !!state &&
    !state.minigame &&
    state.round.phase === 'IDLE' &&
    state.round.order.length === 0 &&
    Object.values(state.scores).every((s) => s === 0)
  useEffect(() => {
    if (preview) return
    if (!audible) return
    if (welcoming) startBed('welcome')
    else stopBed()
  }, [welcoming, audible, preview])

  const enter = useRef(new Map<string, number>())
  const nextSlot = useRef(0)
  const round0 = useRef('')

  const order = state?.round.order ?? []
  const buzzes = order.length
  if (state && state.round.attemptId !== round0.current) {
    round0.current = state.round.attemptId
    enter.current = new Map()
  }
  const nowMs = performance.now()
  const gap = markGap()
  for (const b of order) {
    if (enter.current.has(b.playerId)) continue
    const at = Math.max(nowMs, nextSlot.current)
    enter.current.set(b.playerId, Math.round(at - nowMs))
    nextSlot.current = at + gap
  }

  const standingsList = useRef<HTMLOListElement>(null)
  useFlip(standingsList)

  const seen = useRef(0)
  useEffect(() => {
    if (preview) return
    const was = seen.current
    seen.current = buzzes
    if (buzzes <= was) return
    for (let i = was; i < buzzes; i++)
      playSpaced(i === 0 ? 'leader' : 'stamp')
  }, [buzzes, preview])

  const reveal = useReveal(state?.round, !preview)
  const settled = preview?.settled ?? reveal.settled
  const retired = preview?.retired ?? reveal.retired
  const onSettled = preview ? undefined : reveal.onSettled
  const holding = useClosestHold(state?.round, !preview)
  const scoresShown = useMatchHold(state, state ? (holding ? scoresBeforeClosest(state) : state.scores) : {}, !preview)
  const finale = useFinale(state, now, !preview)

  if (!state) return <main class="board"><p class="board__idle">Connecting</p></main>
  if (state.minigame) {
    const Surface = MINIGAMES[state.minigame.id].board
    return <Surface key={state.minigame.matchId} state={state} frame={minigameFrame} now={now} touches={minigameTouches} join={joinShown(state.minigame.id, state.minigame.phase)} />
  }

  const { round } = state
  const w = wallOf(state, { open, settled, retired })
  const leader = round.order[0]
  const armed = round.phase === 'ARMED' || round.phase === 'COLLECTING'
  const here = state.players.filter((p) => p.connected).length
  const total = state.players.length
  const barred = lockedNames(state)
  const seating = willSeat(state)
  const setlistLabel = setlistPosition(state)
  const qrBig = state.players.length === 0 || state.arrival?.kind === 'lobby' || state.arrival?.kind === 'introduction'

  return (
    <main class="board" data-review-id="board:root">
      <section class={w.moment.startsWith('choice:') || w.moment.startsWith('closest:') ? 'board__wall is-choice' : 'board__wall'}>
        {round.closesAt !== undefined && (w.moment === 'choice:picking' || w.moment === 'buzz:open') && (
          <Countdown until={round.closesAt} now={now} />
        )}
        {w.moment === 'closest:guessing' && w.closest?.closesAt !== undefined && (
          <Countdown until={w.closest.closesAt} now={now} />
        )}
        <div class="board__status" data-review-id="board:status">
          {open && <span class="chip chip--open">Open</span>}
          {armed && !open && <span class="chip chip--armed">Standing by</span>}
          <span class="chip">
            {here === total ? here : `${here} of ${total}`} {(here === total ? here : total) === 1 ? 'player' : 'players'}
          </span>
          {setlistLabel && (
            <span key={state.setlist?.at} class="chip chip--setlist fx-flip" data-review-id="board:setlist">
              {setlistLabel}
            </span>
          )}
          {!audible && <span class="chip">Click for sound</span>}
        </div>

        {w.arrival ? (
          <ArrivalBoard state={state} arrival={w.arrival} feedback={practice} pulseNow={pulseNow} />
        ) : (<>
        <div class="board__above">
          {(w.transcript || w.award) ? (
            <>
              {w.transcript ? (
                <Spoken
                  prefix="board"
                  transcript={w.transcript.text}
                  hit={w.transcript.hit}
                  onSettled={onSettled}
                  instant={!!preview}
                />
              ) : (
                <Held class="board__spoken" />
              )}
              {w.award ? (
                <p data-review-id="board:award" class={isPenalty(w.award) ? 'board__award fx-anchor is-neg' : 'board__award fx-anchor'}>
                  {w.award.scoreless
                    ? (isPenalty(w.award) ? 'Wrong!' : 'Correct!')
                    : `${w.award.points > 0 ? '+' : ''}${w.award.points}`}
                  <Burst kind="dust" from={['left', 'bottom', 'right']} />
                </p>
              ) : (
                <Held class="board__award" />
              )}
              {w.award?.answer ? (
                <p class="board__answer fx-rise" data-review-id="board:answer">{w.award.answer}</p>
              ) : (
                <Held class="board__answer" />
              )}
            </>
          ) : w.unanswered ? (
            <>
              <p data-review-id="board:award" class="board__award fx-anchor">Nobody</p>
              {w.unanswered.answer ? (
                <p class="board__answer fx-rise" data-review-id="board:answer">{w.unanswered.answer}</p>
              ) : (
                <Held class="board__answer" />
              )}
            </>
          ) : w.choices?.correct !== undefined ? (
            <p data-review-id="board:award" class="board__award fx-anchor">
              {w.choices.winners?.length ? `+${w.choices.points} · ${w.choices.winners.length} right` : 'Nobody'}
              {!!w.choices.winners?.length && <Burst kind="dust" from={['left', 'bottom', 'right']} />}
            </p>
          ) : w.closest?.truth ? (
            <p
              data-review-id="board:award"
              class="board__award is-closest fx-anchor"
              style={{ animationDelay: closestStampDelay(w.closest), '--stamp-at': closestStampDelay(w.closest) }}
            >
              {closestStamp(w.closest)}
              {!!w.closest.winners?.length && <Burst kind="dust" from={['left', 'bottom', 'right']} />}
            </p>
          ) : null}
        </div>

        <div class="board__mid">
          {w.hero && <Hero {...w.hero} />}
          {w.finale && (
            <Finale key={state.setlist?.spentAt} tiers={w.finale} step={finale.step} elapsedMs={finale.elapsed} cards={state.night ? recapCards(state.night, state) : []} />
          )}
          {w.next !== null && (
            <div class="board__next fx-rise" data-review-id="board:next">
              {lastUp(state) ? (
                <div class="fx-tada" style={{ animationDelay: 'var(--fx-rise-dur)' }}>
                  <p class="board__next-label">Last question</p>
                  <p class="board__next-value">{w.next} points</p>
                </div>
              ) : (
                <>
                  <p class="board__next-label">Next question</p>
                  <p class="board__next-value">{w.next} points</p>
                </>
              )}
            </div>
          )}
          {w.nominations && (
            <div class="board__noms">
              <p class="board__idle">Who plays?</p>
              {w.nominations === 'teams' ? (
                <div class="board__sides">
                  {state.teams.map((team) => (
                    <div key={team.id} class="board__sidepool">
                      <p class="eyebrow" style={{ color: team.color }}>
                        {team.name}
                      </p>
                      <NomList
                        state={state}
                        seating={seating}
                        entries={state.duel!.pool.filter(
                          (e) =>
                            state.players.find((p) => p.id === e.playerId)?.teamId === team.id,
                        )}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <NomList state={state} seating={seating} entries={state.duel!.pool} />
              )}
            </div>
          )}
          {w.clue && <Question {...w.clue} reveal={w.reveal} now={now} />}
          {w.faceoff && <FaceOff pair={w.faceoff} />}
          {w.call && (
            <p data-review-id="board:call" class={w.call === 'buzz' ? 'board__call' : 'board__idle'}>{CALL_TEXT[w.call]}</p>
          )}
        </div>

        <div class="board__below">
          {w.choices && <Choices c={w.choices} now={now} colorOf={(id) => colorForPlayer(state, id)} />}
          {w.closest && (
            <ClosestLine
              key={round.questionId}
              c={w.closest}
              closed={w.closest.truth === undefined && (allGuessed(state) || (w.closest.closesAt !== undefined && now() >= w.closest.closesAt))}
              colorOf={(id) => colorForPlayer(state, id)}
            />
          )}
          {w.timeline && <Timeline state={state} round={round} enter={enter.current} />}
        </div>
        </>)}

        {w.value !== null && (w.reveal ? (
          <RevealStakes value={w.value} reveal={w.reveal} now={now} />
        ) : (
          <span class="chip board__stakes" data-review-id="board:stakes">{w.value} pts</span>
        ))}

        {w.milestone && (
          <span key={w.milestone} class="board__milestone fx-rise" data-review-id="board:milestone">{w.milestone}</span>
        )}

        {!w.arrival && barred.length > 0 && (
          <div class="board__barred" data-review-id="board:lockouts">
            {barred.map((n) => (
              <span key={n} class="chip chip--barred">{n} out</span>
            ))}
          </div>
        )}

        {!w.arrival && (
          <Reactions state={state} reacted={reacted} rows={w.timeline ? rowsOf(round.order) : 0} lockouts={barred.length > 0} now={pillNow} frozen={!!preview} />
        )}
      </section>

      <aside class="board__side">
        <div class="board__standings" data-review-id="board:standings">
          <p class="eyebrow">Standings</p>
          <Standings list={standingsList} rows={standings({ ...state, scores: scoresShown })} />
        </div>

        <JoinCode small={!qrBig} finale={!!w.finale} />

        <span class="lamp">
          <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </aside>
    </main>
  )
}
