import { useEffect, useRef, useState } from 'preact/hooks'
import type { PokerInput, ReactKind } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import type { MinigamePlayerProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { nextBowSequence } from './bow-control.ts'
import { PendingBar } from './InkParts.tsx'
import { PlayingCard, ShotRing, usePokerCues } from './PokerParts.tsx'
import { classifyGesture, GESTURE, type TracePoint } from './poker.ts'
import { colorForPlayer, ordinal, playerName } from './ui.ts'

const AUTO_NOTE_MS = 2_000
const REACTS = Object.keys(REACT_LABEL) as ReactKind[]

type Move = { kind: PokerInput['kind'] } & Record<string, unknown>

/**
 * The phone is a small felt table: flick the cards up to fold, double tap the
 * felt to check or call, press the cards to peek. Raise and all in are buttons,
 * because an amount wants a slider.
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
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [peek, setPeek] = useState(false)
  const [flying, setFlying] = useState(false)
  const [refused, setRefused] = useState(0)
  const [reactRefused, setReactRefused] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [raiseTo, setRaiseTo] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const seenFeed = useRef(0)

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

  const bar = <div class="player__bar">
    <span class="player__name" style={{ '--id': playerId ? colorForPlayer(state, playerId) : undefined }}>{playerName(state, me)}</span>
  </div>

  if (session.phase === 'results') {
    const place = session.results?.find((row) => row.playerId === me)?.place
    return <main class="player poker-phone">{bar}
      <section class="poker-felt poker-felt--still"><p class="poker-felt__big">{place ? `${ordinal(place)} place` : 'Game over'}</p></section>
    </main>
  }
  if (!poker) return <main class="player">{bar}<PendingBar label={frame?.role === 'spectator' ? 'Watching this game' : 'Starting'} /></main>

  const input = (value: Move) => {
    const seq = nextBowSequence(localStorage)
    send({ t: 'minigameInput', matchId: session.matchId, seq, input: { ...value, at: now() } as PokerInput })
    return seq
  }
  const mine = poker.seats.find((seat) => seat.player === me)
  const legal = poker.legal
  const actorName = poker.actor ? playerName(state, poker.actor) : null
  const reactions = <div class={`poker-reacts ${reactRefused ? 'fx-shake' : ''}`} key={reactRefused}>
    {REACTS.map((kind) => <button key={kind} class="btn poker-react" onClick={() => { reactSeq.current = input({ kind: 'react', react: kind }) }}>{REACT_LABEL[kind]}</button>)}
  </div>

  if (poker.place !== null) {
    return <main class="player poker-phone">{bar}
      <section class="poker-felt poker-felt--still">
        <p class="poker-felt__big fx-rubber-stamp">Out in {ordinal(poker.place)}</p>
        <p class="poker-felt__zone">{actorName ? `${actorName} to act` : `Hand ${poker.handNo}`}</p>
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

  const tapLine = !legal
    ? (actorName ? `${actorName} to act` : '')
    : legal.canCheck ? 'double tap to check' : `double tap to call ${legal.call}`
  const pot = poker.pots.reduce((a, b) => a + b, 0) + poker.seats.reduce((a, seat) => a + seat.bet, 0)
  const highBet = Math.max(0, ...poker.seats.map((seat) => seat.bet))
  const clamp = (to: number) => legal ? Math.min(legal.maxTo, Math.max(legal.minTo, Math.round(to))) : 0
  const openSheet = () => { if (legal) { setRaiseTo(legal.minTo); setSheet(true) } }
  const confirmRaise = () => {
    if (!legal) return
    input(raiseTo >= legal.maxTo ? { kind: 'allIn' } : { kind: 'raise', to: raiseTo })
    setSheet(false)
  }

  return <main class="player poker-phone">
    {bar}
    <div class="poker-phone__status">
      <span>Stack <span class="readout">{mine?.stack ?? 0}</span></span>
      <span>Pot <span class="readout">{pot}</span></span>
      {legal && poker.actBy && <ShotRing until={poker.actBy} total={session.options.shotSec * 1000} now={now()} />}
    </div>
    <section
      class={`poker-felt ${legal ? 'poker-felt--turn' : ''}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    >
      <p class={`poker-felt__zone ${legal && inHand ? '' : 'poker-felt__zone--dim'}`}>
        {inHand ? (legal ? '↑ flick here to fold' : tapLine) : mine?.folded ? 'Folded, watching this hand' : ''}
      </p>
      {inHand && <div
        key={`${hand}-${refused}`}
        class={`poker-hole ${flying ? 'poker-hole--fly' : ''} ${refused && !drag ? 'fx-shake' : ''}`}
        style={drag ? { transform: `translate(${drag.x}px, ${Math.min(drag.y, 40)}px)`, transition: 'none' } : undefined}
      >
        <PlayingCard card={poker.hole![0]} down={!peek && !mine?.cards} class="fx-drop" />
        <PlayingCard card={poker.hole![1]} down={!peek && !mine?.cards} class="fx-drop" />
      </div>}
      {note && <p class="poker-felt__note fx-shake">{note}</p>}
      <p class={`poker-felt__zone ${legal ? '' : 'poker-felt__zone--dim'}`}>{inHand ? tapLine : ''}</p>
    </section>
    {sheet && legal
      ? <div class="poker-sheet">
          <p class="poker-sheet__amount">Raise to <span class="readout">{raiseTo}</span></p>
          <input class="poker-sheet__slider" type="range" min={legal.minTo} max={legal.maxTo} step={1} value={raiseTo}
            onInput={(e) => setRaiseTo(Number((e.target as HTMLInputElement).value))} />
          <div class="poker-sheet__presets">
            <button class="btn" onClick={() => setRaiseTo(clamp(highBet + (pot + legal.call) / 2))}>½ pot</button>
            <button class="btn" onClick={() => setRaiseTo(clamp(highBet + pot + legal.call))}>Pot</button>
            <button class="btn" onClick={() => setRaiseTo(legal.maxTo)}>All in</button>
          </div>
          <div class="poker-sheet__presets">
            <button class="btn" onClick={() => setSheet(false)}>Back</button>
            <button class="btn btn--primary" onClick={confirmRaise}>{raiseTo >= legal.maxTo ? 'All in' : `Raise to ${raiseTo}`}</button>
          </div>
        </div>
      : <div class="poker-actions">
          <button class="btn" disabled={!legal?.canRaise} onClick={openSheet}>{highBet > 0 ? 'Raise' : 'Bet'}</button>
          <button class="btn" disabled={!legal} onClick={() => input({ kind: 'allIn' })}>All in</button>
          {poker.canShow && <button class="btn btn--primary fx-pop" onClick={() => input({ kind: 'show' })}>Show</button>}
        </div>}
    {reactions}
  </main>
}
