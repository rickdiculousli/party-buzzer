import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { PokerInput, ReactKind } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { FeltArc, FeltMark, PlayingCard, ShotRing, reducedMotion, usePokerCues } from './PokerParts.tsx'
import { classifyGesture, GESTURE, type TracePoint } from './poker.ts'
import { pitch, receive, scatter, RECEIVE } from './toss.ts'
import { colorForPlayer, ordinal, playerName } from './ui.ts'

const AUTO_NOTE_MS = 2_000
const REACTS = Object.keys(REACT_LABEL) as ReactKind[]
/** The phone's deal: the second card follows the first by this much. */
const SECOND_CARD_MS = 230
/** How the two hole cards lie once collected: squared up, the second just offset over the first. */
const REST = [-3, 4]

type Move = { kind: PokerInput['kind'] } & Record<string, unknown>

/**
 * One hole card. On a fresh deal it is pitched in from above the top edge of
 * the phone after `delay` and lands loose; at `collectAt` (ms from its own
 * start) the pair is gathered toward you and tapped square.
 */
function DealtCard({ card, up, index, delay, collectAt, seed, hand }: {
  card: string; up: boolean; index: 0 | 1; delay: number | null; collectAt: number; seed: number; hand: number
}) {
  const el = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const node = el.current
    if (!node || delay === null || reducedMotion()) return
    const box = node.getBoundingClientRect()
    const from = { x: innerWidth / 2 - (box.left + box.width / 2), y: -(box.top + box.height * 1.2) }
    const neat = { x: 0, y: 0, rot: REST[index] }
    const flight = pitch(from, scatter(neat, box.width, mulberry32(seed * 7 + 1)), mulberry32(seed))
    const frames = receive(flight, neat, collectAt, mulberry32(hand * 7 + 3))
    const total = frames[frames.length - 1].t
    const run = node.animate(
      frames.map((f) => ({ transform: `translate(${f.x}px, ${f.y}px) rotate(${f.rot}deg) scale(${1 + f.lift})`, offset: f.t / total })),
      { duration: total, delay, fill: 'backwards', easing: 'linear' },
    )
    return () => run.cancel()
  }, [])
  return <span ref={el} class="poker-hole__card" style={{ transform: `rotate(${REST[index]}deg)` }}>
    <PlayingCard card={card} up={up} />
  </span>
}

/**
 * The phone is a small felt table under its own lamp: flick the cards up to
 * fold, double tap the felt to check or call, press the cards to peek. Raise
 * and all in sit on the rail, because an amount wants a slider.
 */
export function PokerPlayer({ state, playerId, frame, now, send, ack }: MinigamePlayerProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'player', session.matchId)
  const me = playerId ?? ''
  usePokerCues(poker, playerId)

  const trace = useRef<TracePoint[]>([])
  const onCards = useRef(false)
  const lastTap = useRef<number | null>(null)
  const peekTimer = useRef<ReturnType<typeof setTimeout>>()
  const reactSeq = useRef(-1)
  const seenFeed = useRef(0)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [peek, setPeek] = useState(false)
  const [flying, setFlying] = useState(false)
  const [refused, setRefused] = useState(0)
  const [reactRefused, setReactRefused] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [raiseTo, setRaiseTo] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  // When this hand's cards were dealt to this phone. A reload mid-hand deals nothing.
  const deal = useRef<{ hand: number; dealing: boolean } | null>(null)
  if (poker && deal.current?.hand !== poker.handNo) deal.current = { hand: poker.handNo, dealing: !!deal.current || poker.phase === 'deal' }

  const myTurn = !!poker?.legal
  const hand = poker?.handNo ?? 0
  useEffect(() => { setFlying(false); setSheet(false); setNote(null) }, [hand])
  useEffect(() => { if (myTurn) navigator.vibrate?.(60) }, [myTurn, hand, poker?.street])
  useEffect(() => { if (!myTurn) setSheet(false) }, [myTurn])
  useEffect(() => {
    if (ack && ack.seq === reactSeq.current && ack.status === 'refused') setReactRefused((n) => n + 1)
  }, [ack])
  useEffect(() => {
    if (!poker) return
    const fresh = poker.feed.filter((entry) => entry.id > seenFeed.current)
    seenFeed.current = Math.max(seenFeed.current, ...poker.feed.map((entry) => entry.id))
    const auto = fresh.find((entry) => entry.player === me && entry.auto)
    if (!auto) return
    setNote(auto.kind === 'fold' ? 'Auto-folded' : 'Auto-checked')
    const timer = setTimeout(() => setNote(null), AUTO_NOTE_MS)
    return () => clearTimeout(timer)
  }, [poker?.feed])

  const name = <p class="poker-phone__name" style={{ color: playerId ? colorForPlayer(state, playerId) : undefined }}>{playerName(state, me)}</p>

  if (session.phase === 'results') {
    const place = session.results?.find((row) => row.playerId === me)?.place
    return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
      <header class="poker-phone__top">{name}</header>
      <section class="poker-phone__still">
        <FeltMark text={place ? `${ordinal(place)} place` : 'Game over'} class="poker-phone__big" />
        {place === 1 && <FeltMark text="Takes the table" class="poker-phone__small" />}
      </section>
    </main>
  }
  if (!poker) return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
    <header class="poker-phone__top">{name}</header>
    <section class="poker-phone__still">
      <FeltMark text={frame?.role === 'spectator' ? 'Watching this game' : 'Shuffling up'} class="poker-phone__small" />
    </section>
  </main>

  const input = (value: Move) => {
    const seq = nextBowSequence(localStorage)
    send({ t: 'minigameInput', matchId: session.matchId, seq, input: { ...value, at: now() } as PokerInput })
    return seq
  }
  const mine = poker.seats.find((seat) => seat.player === me)
  const legal = poker.legal
  const actorName = poker.actor ? playerName(state, poker.actor) : null
  const pot = poker.pots.reduce((a, b) => a + b, 0) + poker.seats.reduce((a, seat) => a + seat.bet, 0)
  const reactions = <div key={reactRefused} class={`poker-tokens ${reactRefused ? 'fx-shake' : ''}`}>
    {REACTS.map((kind) => <button key={kind} class="poker-token" onClick={() => { reactSeq.current = input({ kind: 'react', react: kind }) }}>{REACT_LABEL[kind]}</button>)}
  </div>
  const top = <header class="poker-phone__top">
    {name}
    <p class="poker-phone__money">
      <span>Stack <b>{(mine?.stack ?? 0).toLocaleString()}</b></span>
      <span>Pot <b>{pot.toLocaleString()}</b></span>
    </p>
    {legal && poker.actBy && <ShotRing until={poker.actBy} total={session.options.shotSec * 1000} now={now()} />}
  </header>

  if (poker.place !== null) {
    return <main class="player poker-phone felt felt--phone"><div class="felt__lamp felt__lamp--phone" />
      {top}
      <section class="poker-phone__still">
        <FeltMark text={`Out in ${ordinal(poker.place)}`} class="poker-phone__big fx-rubber-stamp" />
        <FeltMark text={actorName ? `${actorName} to act` : `Hand ${poker.handNo}`} class="poker-phone__small" />
      </section>
      {reactions}
    </main>
  }

  const inHand = !!poker.hole && !!mine && !mine.folded
  const point = (e: PointerEvent): TracePoint => ({ x: e.clientX, y: e.clientY, t: e.timeStamp })
  const down = (e: PointerEvent) => {
    // Capture keeps a flick's trace when the finger leaves the felt; a browser may refuse it.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* the trace still works inside the felt */ }
    trace.current = [point(e)]
    onCards.current = !!(e.target as HTMLElement).closest('.poker-hole')
    clearTimeout(peekTimer.current)
    if (onCards.current) peekTimer.current = setTimeout(() => setPeek(true), GESTURE.pressMs)
  }
  const move = (e: PointerEvent) => {
    if (!trace.current.length) return
    trace.current.push(point(e))
    if (onCards.current) setDrag({ x: e.clientX - trace.current[0].x, y: e.clientY - trace.current[0].y })
  }
  const up = (e: PointerEvent) => {
    if (!trace.current.length) return
    trace.current.push(point(e))
    clearTimeout(peekTimer.current)
    setPeek(false)
    setDrag(null)
    const gesture = classifyGesture(trace.current, lastTap.current)
    const end = trace.current[trace.current.length - 1].t
    trace.current = []
    if (gesture.kind === 'flick' && onCards.current && inHand) {
      if (!legal) return setRefused((n) => n + 1)
      setFlying(true)
      input({ kind: 'fold', flick: gesture.flick })
    } else if (gesture.kind === 'doubleTap') {
      lastTap.current = null
      if (legal) input({ kind: legal.canCheck ? 'check' : 'call' })
    } else if (gesture.kind === 'tap') {
      lastTap.current = end
    }
  }

  const waiting = actorName ? `${actorName} to act` : ''
  const topLine = !inHand ? (mine?.folded ? 'Folded' : '') : 'Flick here to fold'
  const tapLine = !inHand ? waiting : !legal ? waiting : legal.canCheck ? 'Double tap to check' : `Double tap to call ${legal.call.toLocaleString()}`
  const highBet = Math.max(0, ...poker.seats.map((seat) => seat.bet))
  const clamp = (to: number) => legal ? Math.min(legal.maxTo, Math.max(legal.minTo, Math.round(to))) : 0
  const openSheet = () => { if (legal) { setRaiseTo(legal.minTo); setSheet(true) } }
  const confirmRaise = () => {
    if (!legal) return
    input(raiseTo >= legal.maxTo ? { kind: 'allIn' } : { kind: 'raise', to: raiseTo })
    setSheet(false)
  }
  const dealing = deal.current?.dealing ?? false
  // Both cards are gathered together, once the second has had time to land and you have reached for it.
  // The dealer's own rhythm: the second card comes round a little sooner or later each hand.
  const second = SECOND_CARD_MS * (0.75 + 0.6 * mulberry32(hand * 5 + 2)())
  const secondLands = second + pitch({ x: 0, y: -innerHeight }, { x: 0, y: 0, rot: 0 }, mulberry32(hand * 2 + 1)).at(-1)!.t
  // Pitches vary, so allow a little for this one landing late before you reach for the pair.
  const collectAt = secondLands + 150 + RECEIVE.reactMs[0] + (RECEIVE.reactMs[1] - RECEIVE.reactMs[0]) * mulberry32(hand * 13)()

  return <main class={`player poker-phone felt felt--phone ${legal ? 'poker-phone--turn' : ''}`}>
    <div class="felt__lamp felt__lamp--phone" />
    {top}
    <section class="poker-phone__table" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <FeltArc text={topLine} bow="up" class={legal && inHand ? '' : 'felt-arc--dim'} />
      <div class="poker-phone__spot">
        {inHand && <div
          key={`${hand}-${refused}`}
          class={`poker-hole ${flying ? 'poker-hole--fly' : ''} ${refused && !drag ? 'fx-shake' : ''}`}
          style={drag ? { transform: `translate(${drag.x}px, ${Math.min(drag.y, 40)}px) rotate(${drag.x / 30}deg)`, transition: 'none' } : undefined}
        >
          {([0, 1] as const).map((k) => <DealtCard key={`${hand}-${k}`} card={poker.hole![k]} up={peek || !!mine?.cards} index={k}
            delay={dealing ? k * second : null} collectAt={collectAt - k * second} seed={hand * 2 + k} hand={hand} />)}
        </div>}
        {note && <p class="poker-phone__note fx-shake">{note}</p>}
      </div>
      <FeltArc text={tapLine} bow="down" class={legal ? '' : 'felt-arc--dim'} />
    </section>
    {reactions}
    {sheet && legal
      ? <div class="poker-rail poker-rail--sheet">
          <p class="poker-sheet__amount">Raise to <b>{raiseTo.toLocaleString()}</b></p>
          <input class="poker-sheet__slider" type="range" min={legal.minTo} max={legal.maxTo} step={1} value={raiseTo}
            aria-label="Raise to" onInput={(e) => setRaiseTo(Number((e.target as HTMLInputElement).value))} />
          <div class="poker-rail__row">
            <button class="poker-plaque" onClick={() => setRaiseTo(clamp(highBet + (pot + legal.call) / 2))}>½ pot</button>
            <button class="poker-plaque" onClick={() => setRaiseTo(clamp(highBet + pot + legal.call))}>Pot</button>
            <button class="poker-plaque" onClick={() => setRaiseTo(legal.maxTo)}>All in</button>
          </div>
          <div class="poker-rail__row">
            <button class="poker-plaque poker-plaque--quiet" onClick={() => setSheet(false)}>Back</button>
            <button class="poker-plaque poker-plaque--go" onClick={confirmRaise}>{raiseTo >= legal.maxTo ? 'All in' : `Raise to ${raiseTo.toLocaleString()}`}</button>
          </div>
        </div>
      : <div class="poker-rail">
          <div class="poker-rail__row">
            <button class="poker-plaque" disabled={!legal?.canRaise} onClick={openSheet}>{highBet > 0 ? 'Raise' : 'Bet'}</button>
            <button class="poker-plaque" disabled={!legal?.canAllIn} onClick={() => input({ kind: 'allIn' })}>All in</button>
            {poker.canShow && <button class="poker-plaque poker-plaque--go fx-pop" onClick={() => input({ kind: 'show' })}>Show</button>}
          </div>
        </div>}
  </main>
}
