import { useEffect, useRef, useState } from 'preact/hooks'
import type { PlayerId, PokerFeedEntry } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { Burst, CountUp, Letters } from './fx.tsx'
import { Flight, PlayingCard, ShotRing, usePokerCues } from './PokerParts.tsx'
import { feedLine, foldPath, seatPositions, POKER_RULES, type Leg } from './poker.ts'
import { colorForPlayer, ordinal, playerName, setlistPosition } from './ui.ts'

type Point = { x: number; y: number }
const CENTRE = { x: 0.5, y: 0.5 }
const PILE = { x: 0.7, y: 0.3 }
const POT = { x: 0.5, y: 0.62 }
const CHIP_MS = 420
const BANNER_MS = 2_600
const REACTION_MS = 1_800
const FEED_SHOWN = 8

/** A seat's bets and cards sit a little way in from its name, toward the felt's middle. */
const inward = (p: Point, by: number): Point => ({ x: p.x + (CENTRE.x - p.x) * by, y: p.y + (CENTRE.y - p.y) * by })

/** Entries newer than the last frame's; the first frame only sets the baseline, so a reload replays nothing. */
function useFresh<T extends { id: number }>(list: T[] | undefined, matchId: string): T[] {
  const seen = useRef<{ match: string; id: number } | null>(null)
  if (!list) return []
  const top = Math.max(0, ...list.map((entry) => entry.id))
  if (!seen.current || seen.current.match !== matchId) {
    seen.current = { match: matchId, id: top }
    return []
  }
  const fresh = list.filter((entry) => entry.id > seen.current!.id)
  seen.current.id = Math.max(seen.current.id, top)
  return fresh
}

/** Keeps short-lived things on screen for `ms`, then drops them. */
function useTransient<T extends { key: string }>(ms: number): [T[], (items: T[]) => void] {
  const [items, setItems] = useState<T[]>([])
  const add = (fresh: T[]) => {
    if (!fresh.length) return
    setItems((now) => [...now, ...fresh])
    const keys = new Set(fresh.map((item) => item.key))
    setTimeout(() => setItems((now) => now.filter((item) => !keys.has(item.key))), ms)
  }
  return [items, add]
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

type Fly = { key: string; from: Point; legs: Leg[]; kind: 'fold' | 'chips'; easing: string }

export function PokerBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'board', session.matchId)
  usePokerCues(poker, 'board')
  const nameOf = (id: PlayerId) => playerName(state, id)
  const place = setlistPosition(state) ?? 'Poker'

  const [flights, setFlights] = useState<Fly[]>([])
  const [banners, addBanners] = useTransient<{ key: string; text: string }>(BANNER_MS)
  const [floats, addFloats] = useTransient<{ key: string; player: PlayerId; text: string }>(REACTION_MS)
  const fresh = useFresh(poker?.feed, session.matchId)
  const freshReacts = useFresh(poker?.reactions, session.matchId)

  const seats = poker?.seats ?? []
  const spots = seatPositions(seats.length)
  const spotOf = (id: PlayerId | null) => spots[seats.findIndex((seat) => seat.player === id)] ?? CENTRE

  useEffect(() => {
    if (!poker) return
    const flies: Fly[] = []
    const charge = cssVar('--rate-charge', 'cubic-bezier(0.6, 0, 0.9, 0.4)')
    for (const entry of fresh) {
      const spot = spotOf(entry.player)
      if (entry.kind === 'fold') {
        flies.push({ key: `f${entry.id}`, kind: 'fold', from: inward(spot, 0.36), legs: foldPath(CENTRE, PILE, entry.flick ?? null), easing: entry.flick ? 'ease-out' : 'ease-in-out' })
      } else if (entry.kind === 'call' || entry.kind === 'bet' || entry.kind === 'raise' || entry.kind === 'blind' || entry.kind === 'allIn') {
        flies.push({ key: `c${entry.id}`, kind: 'chips', from: spot, legs: [{ at: { ...inward(spot, 0.55), rotate: 0 }, ms: CHIP_MS }], easing: charge })
      }
    }
    if (flies.length) setFlights((now) => [...now, ...flies])
    addBanners(fresh.filter((entry) => entry.kind === 'level').map((entry) => ({ key: `l${entry.id}`, text: `Blinds ${Math.floor(entry.amount! / 2)} / ${entry.amount}` })))
    addFloats(freshReacts.map((r) => ({ key: `r${r.id}`, player: r.player, text: REACT_LABEL[r.kind] })))
  }, [poker])

  if (session.phase === 'results') {
    const rows = [...session.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    const winner = rows[0]
    return <main class="board">
      <section class="board__wall">
        <div class="board__status"><span class="chip">{place}</span></div>
        <div class="board__above" />
        <div class="board__mid">
          {winner && <p class="board__hero fx-hero-slam-glow" style={{ '--id': colorForPlayer(state, winner.playerId) }}>
            {nameOf(winner.playerId)}<Burst kind="confetti" />
          </p>}
        </div>
        <div class="board__below">
          <ol class="poker-places">{rows.map((row) => <li key={row.playerId}>
            <span class="readout">{row.place ? ordinal(row.place) : ''}</span> {nameOf(row.playerId)}
          </li>)}</ol>
        </div>
      </section>
    </main>
  }

  if (!poker) return <main class="board">
    <section class="board__wall">
      <div class="board__status"><span class="chip">{place}</span></div>
      <div class="board__above" />
      <div class="board__mid">
        <div class="board__next">
          <p class="board__next-label">{session.phase === 'ready' ? (session.checkpoint ? `Resumes from ${session.checkpoint.label}` : 'Next up') : 'Starting'}</p>
          <p class="board__next-value">Poker</p>
        </div>
      </div>
      <div class="board__below"><p class="sketch-rules">{POKER_RULES}</p></div>
    </section>
  </main>

  const lastBy = new Map<PlayerId, PokerFeedEntry>()
  for (const entry of poker.feed) if (entry.player && entry.kind !== 'win' && entry.kind !== 'bust') lastBy.set(entry.player, entry)
  const winners = new Set(poker.showdown?.flatMap((pot) => pot.winners) ?? [])
  const shown = new Set(poker.showdown?.[0]?.five ?? [])
  const mainName = poker.showdown?.[0]?.name
  const folding = flights.filter((f) => f.kind === 'fold').length
  const potTotal = poker.pots.reduce((a, b) => a + b, 0)
  const nextLevel = Math.max(0, Math.ceil((poker.nextLevelAt - now()) / 1000))

  return <main class="board poker-board">
    <header class="poker-top">
      <span class="chip">{place}</span>
      <span class="chip">Hand {poker.handNo}</span>
      <span class="poker-top__blinds">Blinds {poker.sb} / {poker.bb}</span>
      <span class="poker-top__next">Next level <span class="readout">{Math.floor(nextLevel / 60)}:{String(nextLevel % 60).padStart(2, '0')}</span></span>
    </header>
    <section class="poker-table">
      <div class="poker-oval" />
      <div class="poker-centre">
        <div class="poker-community">
          {poker.board.map((card) => <PlayingCard key={card} card={card} class={`fx-flip ${shown.size && !shown.has(card) ? 'poker-card--dim' : ''} ${shown.has(card) ? 'poker-card--lift' : ''}`} />)}
        </div>
        {mainName && <Letters key={poker.handNo} text={mainName} class="poker-hand-name" />}
      </div>
      <p class="poker-pot" style={{ left: `${POT.x * 100}%`, top: `${POT.y * 100}%` }}>
        {potTotal > 0 && <>Pot <span class="readout"><CountUp key={potTotal} to={potTotal} /></span></>}
        {poker.pots.length > 1 && <span class="poker-pot__side"> · {poker.pots.length - 1} side</span>}
      </p>
      <div class="poker-pile" style={{ left: `${PILE.x * 100}%`, top: `${PILE.y * 100}%` }}>
        {Array.from({ length: Math.max(0, poker.discard / 2 - folding) }, (_, i) =>
          <PlayingCard key={i} card={null} class="poker-pile__card" />)}
      </div>

      {seats.map((seat, i) => {
        const spot = spots[i]
        const bet = inward(spot, 0.55)
        const last = lastBy.get(seat.player)
        const acting = poker.actor === seat.player
        const won = winners.has(seat.player)
        const odds = poker.equity?.[seat.player]
        return <div key={seat.player}>
          <div
            class={`poker-seat ${seat.folded ? 'poker-seat--folded' : ''} ${seat.busted ? 'poker-seat--out fx-poof' : ''} ${acting ? 'fx-glow-pulse' : ''}`}
            style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, '--id': colorForPlayer(state, seat.player), '--fx-color': 'var(--tungsten)' }}
          >
            <div key={won ? `w${poker.handNo}` : 'seat'} class={won ? 'fx-tada' : ''}>
              <p class="poker-seat__name">{nameOf(seat.player)}{seat.away && <span class="poker-seat__away"> away</span>}</p>
              <p class="poker-seat__stack"><span key={seat.stack} class="fx-flash">{seat.stack}</span></p>
              <p class="poker-seat__marks">
                {seat.button && <span class="chip poker-mark">D</span>}
                {seat.sb && <span class="chip poker-mark">SB</span>}
                {seat.bb && <span class="chip poker-mark">BB</span>}
                {odds !== undefined && <span class="readout poker-odds">{Math.round(odds * 100)}%</span>}
              </p>
              {won && <Burst kind="stars" />}
            </div>
            {acting && poker.actBy && <ShotRing class="poker-seat__ring" until={poker.actBy} total={(seat.away ? 2 : session.options.shotSec) * 1000} now={now()} />}
            {last && !seat.busted && <span key={last.id} class={`chip poker-last ${last.kind === 'allIn' ? 'fx-zoom poker-last--allin' : 'fx-pop'}`}>
              {last.kind === 'allIn' ? 'All in' : capital(feedLine(last, () => '').trim())}
            </span>}
            {seat.busted && <span class="poker-seat__stamp fx-rubber-stamp">{bustLine(poker.feed, seat.player)}</span>}
          </div>
          {!seat.busted && !seat.folded && poker.handNo > 0 && <div class="poker-hole-cards" style={{ left: `${inward(spot, 0.36).x * 100}%`, top: `${inward(spot, 0.36).y * 100}%` }}>
            {[0, 1].map((n) => <PlayingCard key={`${poker.handNo}-${n}-${seat.cards ? 'up' : 'down'}`} card={seat.cards?.[n] ?? null}
              class={`${seat.cards ? 'fx-flip' : 'fx-drop'} ${seat.cards && shown.size && won && shown.has(seat.cards[n]) ? 'poker-card--lift' : ''} ${seat.cards && shown.size && !won ? 'poker-card--dim' : ''}`} />)}
          </div>}
          {seat.bet > 0 && <p class="poker-bet" style={{ left: `${bet.x * 100}%`, top: `${bet.y * 100}%` }}><span class="readout">{seat.bet}</span></p>}
        </div>
      })}

      {flights.map((f) => <Flight key={f.key} from={f.from} legs={f.legs} easing={f.easing}
        done={() => setFlights((now) => now.filter((other) => other.key !== f.key))}>
        {f.kind === 'fold'
          ? <span class="poker-flight__pair"><PlayingCard card={null} /><PlayingCard card={null} /></span>
          : <span class="poker-chip" />}
      </Flight>)}
      {floats.map((f) => {
        const spot = spotOf(f.player)
        return <p key={f.key} class="poker-float fx-rise" style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, '--id': colorForPlayer(state, f.player) }}>{f.text}</p>
      })}
      {banners.map((b) => <p key={b.key} class="poker-banner fx-zoom">{b.text}</p>)}
    </section>
    <aside class="poker-feed">
      <ol>{poker.feed.filter((entry) => entry.kind !== 'blind').slice(-FEED_SHOWN).map((entry) =>
        <li key={entry.id} class="fx-slide" style={{ '--id': entry.player ? colorForPlayer(state, entry.player) : undefined }}>{feedLine(entry, nameOf)}</li>)}
      </ol>
    </aside>
  </main>
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function bustLine(feed: PokerFeedEntry[], player: PlayerId): string {
  const entry = [...feed].reverse().find((e) => e.kind === 'bust' && e.player === player)
  return entry?.amount ? `Out in ${ordinal(entry.amount)}` : 'Out'
}

