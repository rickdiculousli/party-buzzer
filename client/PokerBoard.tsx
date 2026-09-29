import { useEffect, useRef, useState } from 'preact/hooks'
import type { PlayerId, PokerFeedEntry } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { matchFrame } from './minigame-info.ts'
import { Burst, Letters } from './fx.tsx'
import { ChipStack, DealerPuck, FeltMark, PaintPile, Piece, PlayingCard, ShotRing, reducedMotion, usePokerCues, useSize } from './PokerParts.tsx'
import { ELLIPSE, feedLine, seatPositions, POKER_RULES } from './poker.ts'
import { chain, pitch, receive, scatter, slide, sweep, toss, RECEIVE, type Frame, type Pose } from './toss.ts'
import { colorForPlayer, ordinal, playerName, setlistPosition } from './ui.ts'

type Point = { x: number; y: number }
/** How long folded cards lie in the middle before the dealer sweeps them. */
const LINGER_MS = 700
/** Longest gap between cards in a deal; a big table deals faster so the round fits the server's beat. */
const DEAL_GAP_MS = 150
const DEAL_WINDOW_MS = 1_300
const FLOP_GAP_MS = 110
/** A pitched community card takes about this long to come to rest. */
const PITCH_MS = 950
const BANNER_MS = 2_600
const REACTION_MS = 1_800
const LOG_LINES = 7
/** Where things sit, as shares of the way from a seat to the middle. */
const HOLE_IN = 0.36
const BET_IN = 0.57

const toward = (p: Point, c: Point, by: number): Point => ({ x: p.x + (c.x - p.x) * by, y: p.y + (c.y - p.y) * by })
/** A stable seed for one card's throw, so a re-render never re-rolls its path. */
const seedOf = (...parts: (string | number)[]) => {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}
/** How far off square a card comes to rest, in degrees, fixed for that card so it never moves after landing. */
const lie = (spread: number, ...parts: (string | number)[]) => (mulberry32(seedOf('lie', ...parts))() * 2 - 1) * spread

/** Entries newer than the last frame's. The first frame only sets the baseline, so a reload replays nothing. */
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

type Ghost = { key: string; pose: Pose; frames: Frame[]; kind: 'fold' | 'chips' | 'bet'; amount?: number; seat?: number }

/**
 * The board is the table under one lamp: felt to every edge, seats printed
 * around it, and a dealer just off the top edge who pitches every card.
 */
export function PokerBoard({ state, frame, now }: MinigameBoardProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'board', session.matchId)
  usePokerCues(poker, 'board')
  const nameOf = (id: PlayerId) => playerName(state, id)
  const place = setlistPosition(state) ?? 'Poker'
  const [tableRef, { w, h }] = useSize<HTMLDivElement>()

  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [banners, setBanners] = useState<{ key: string; text: string }[]>([])
  const [floats, setFloats] = useState<{ key: string; player: PlayerId; text: string }[]>([])
  const [landed, setLanded] = useState<number | null>(null)
  // When this hand was dealt. A reload mid-hand deals nothing; one that lands during a deal still watches it.
  const deal = useRef<{ hand: number; at: number | null } | null>(null)
  if (poker && deal.current?.hand !== poker.handNo) deal.current = { hand: poker.handNo, at: deal.current || poker.phase === 'deal' ? performance.now() : null }
  const fresh = useFresh(poker?.feed, session.matchId)
  const freshReacts = useFresh(poker?.reactions, session.matchId)
  const prev = useRef<typeof poker>(null)

  // Geometry, in table pixels.
  const seats = poker?.seats ?? []
  const cardW = Math.round(Math.min(92, Math.max(44, w * 0.046)))
  const centre = { x: ELLIPSE.cx * w, y: ELLIPSE.cy * h }
  const spots = seatPositions(seats.length).map((p) => ({ x: p.x * w, y: p.y * h }))
  const dealer = { x: centre.x, y: -cardW * 1.6 }
  const board = (i: number): Pose => ({ x: centre.x + (i - 2) * cardW * 1.14, y: centre.y - h * 0.035, rot: lie(2, poker?.handNo ?? 0, 'b', i) })
  const potAt = { x: centre.x, y: centre.y + h * 0.085 }
  const muck: Pose = { x: centre.x + cardW * 3.9, y: centre.y - h * 0.035, rot: 14 }
  const holeOf = (i: number, k: 0 | 1): Pose => {
    const at = toward(spots[i], centre, HOLE_IN)
    const tilt = ((spots[i].x - centre.x) / w) * -18
    // A collected pair: squared up, the second card just offset over the first.
    return { x: at.x + (k ? 0.14 : -0.14) * cardW, y: at.y + (k ? 2 : 0), rot: tilt + (k ? 3 : -2) + lie(2, poker?.handNo ?? 0, i, k) }
  }
  const betOf = (i: number) => toward(spots[i], centre, BET_IN)
  const seatIndex = (id: PlayerId | null) => seats.findIndex((seat) => seat.player === id)

  useEffect(() => {
    if (!poker || !w) return
    const before = prev.current
    prev.current = poker
    const motion = !reducedMotion()
    const add: Ghost[] = []
    for (const entry of fresh) {
      const i = seatIndex(entry.player)
      if (entry.kind === 'fold' && i >= 0 && motion) {
        // The two cards leave together but fly apart: each has its own throw, and they are swept one after the other.
        for (const k of [0, 1] as const) {
          const thrown = toss(holeOf(i, k), centre, entry.flick ?? null, mulberry32(seedOf(entry.id, k)))
          add.push({ key: `f${entry.id}-${k}`, kind: 'fold', pose: muck, frames: chain(thrown.frames, LINGER_MS + k * 90, sweep(thrown.rest, muck)) })
        }
      }
      const bets = entry.kind === 'call' || entry.kind === 'bet' || entry.kind === 'raise' || entry.kind === 'allIn' || entry.kind === 'blind'
      if (bets && i >= 0 && motion) {
        const moved = (entry.amount ?? 0) - (before?.seats.find((seat) => seat.player === entry.player)?.bet ?? 0)
        if (moved > 0) {
          const to = { ...betOf(i), rot: 0 }
          add.push({ key: `c${entry.id}`, kind: 'bet', seat: i, amount: moved, pose: to, frames: slide({ ...toward(spots[i], centre, 0.12), rot: 0 }, to, mulberry32(entry.id), { hand: 0.4, lift: 0, wobble: 0.02 }) })
        }
      }
      if (entry.kind === 'win' && i >= 0 && motion) {
        const to = { ...toward(spots[i], centre, 0.3), rot: 0 }
        add.push({ key: `w${entry.id}`, kind: 'chips', amount: entry.amount, pose: to, frames: slide({ ...potAt, rot: 0 }, to, mulberry32(entry.id), { hand: 0.35, lift: 0, wobble: 0.03, skidTau: 200 }) })
      }
      if (entry.kind === 'level') {
        const key = `l${entry.id}`
        setBanners((all) => [...all, { key, text: `Blinds ${Math.floor(entry.amount! / 2)} / ${entry.amount}` }])
        setTimeout(() => setBanners((all) => all.filter((b) => b.key !== key)), BANNER_MS)
      }
    }
    // A street closes: the dealer draws every bet into the pot.
    if (before && motion && poker.handNo === before.handNo && before.seats.some((seat) => seat.bet > 0) && poker.seats.every((seat) => seat.bet === 0)) {
      before.seats.forEach((seat, i) => {
        if (!seat.bet) return
        add.push({ key: `s${poker.handNo}-${poker.street}-${i}`, kind: 'chips', amount: seat.bet, pose: { ...potAt, rot: 0 }, frames: sweep({ ...betOf(i), rot: 0 }, { ...potAt, rot: 0 }) })
      })
    }
    if (add.length) setGhosts((all) => [...all, ...add])
    if (freshReacts.length) {
      const items = freshReacts.map((r) => ({ key: `r${r.id}`, player: r.player, text: REACT_LABEL[r.kind] }))
      setFloats((all) => [...all, ...items])
      setTimeout(() => setFloats((all) => all.filter((f) => !items.some((item) => item.key === f.key))), REACTION_MS)
    }
  }, [poker])

  // Community cards land face down and turn over once the last card of their street is down.
  const boardLen = poker?.board.length ?? 0
  const down = landed ?? boardLen
  useEffect(() => {
    if (!poker) return
    if (boardLen <= down) { setLanded(boardLen); return }
    const timer = setTimeout(() => setLanded(boardLen), reducedMotion() ? 0 : PITCH_MS + (boardLen - down - 1) * FLOP_GAP_MS)
    return () => clearTimeout(timer)
  }, [boardLen, !!poker])

  if (session.phase === 'results') {
    const rows = [...session.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    const winner = rows[0]
    return <main class="board poker-room">
      <div class="felt felt--board"><div class="felt__lamp felt__lamp--centre" />
        <section class="poker-final">
          {winner && <p class="poker-final__name fx-hero-slam-glow" style={{ '--id': colorForPlayer(state, winner.playerId) }}>
            {nameOf(winner.playerId)}<Burst kind="confetti" />
          </p>}
          <FeltMark text="Takes the table" class="poker-final__sub" />
          <ol class="poker-final__places">{rows.slice(1).map((row) => <li key={row.playerId}>
            <span class="poker-final__place">{row.place ? ordinal(row.place) : ''}</span>
            <span style={{ color: colorForPlayer(state, row.playerId) }}>{nameOf(row.playerId)}</span>
          </li>)}</ol>
        </section>
      </div>
    </main>
  }

  if (!poker) return <main class="board poker-room">
    <div class="felt felt--board"><div class="felt__lamp felt__lamp--centre" />
      <section class="poker-final">
        <FeltMark text="Party Buzzer" class="poker-logo__name" />
        <FeltMark text="No-limit Hold'em" class="poker-logo__game" />
        <p class="poker-waiting">{session.phase === 'ready' ? (session.checkpoint ? `Resumes from ${session.checkpoint.label}` : 'Next up') : 'Shuffling up'}</p>
        <p class="poker-rules">{POKER_RULES}</p>
      </section>
    </div>
  </main>

  // Each seat's last word this hand. A hand's log starts at its two blinds.
  const lastBy = new Map<PlayerId, PokerFeedEntry>()
  const blindAt = poker.feed.findLastIndex((entry) => entry.kind === 'blind')
  const handStart = blindAt > 0 && poker.feed[blindAt - 1].kind === 'blind' ? blindAt - 1 : Math.max(0, blindAt)
  for (const entry of poker.feed.slice(handStart)) if (entry.player && entry.kind !== 'win' && entry.kind !== 'bust') lastBy.set(entry.player, entry)
  const winners = new Set(poker.showdown?.flatMap((pot) => pot.winners) ?? [])
  const five = new Set(poker.showdown?.[0]?.five ?? [])
  const handName = poker.showdown?.[0]?.name
  const folding = ghosts.filter((g) => g.kind === 'fold').length / 2
  const potTotal = poker.pots.reduce((a, b) => a + b, 0)
  const nextLevel = Math.max(0, Math.ceil((poker.nextLevelAt - now()) / 1000))
  const actor = seatIndex(poker.actor)
  const buttonAt = seats.findIndex((seat) => seat.button)

  // The deal: clockwise from the seat left of the button, one card each, then the second.
  const live = seats.map((seat, i) => ({ seat, i })).filter(({ seat }) => !seat.busted)
  const start = Math.max(0, live.findIndex(({ i }) => i > buttonAt))
  const order = [...live.slice(start), ...live.slice(0, start)].map(({ i }) => i)
  const gap = Math.min(DEAL_GAP_MS, DEAL_WINDOW_MS / Math.max(1, order.length * 2))
  const dealtAt = deal.current?.at ?? null
  const dealDelay = (i: number, k: 0 | 1) =>
    dealtAt === null ? null : Math.max(0, dealtAt + (k * order.length + order.indexOf(i)) * gap - performance.now())
  /**
   * One seat's deal: both cards land loose where the pitches leave them, and
   * once the second is down the player takes a moment, gathers the pair and
   * taps it square. Null when this hand was not dealt in front of us.
   */
  const dealtTo = (i: number): [Frame[], Frame[]] | null => {
    const delays = [dealDelay(i, 0), dealDelay(i, 1)]
    if (delays[0] === null || delays[1] === null) return null
    const flights = ([0, 1] as const).map((k) => pitch(dealer, scatter(holeOf(i, k), cardW, mulberry32(seedOf(poker.handNo, i, k, 'land'))), mulberry32(seedOf(poker.handNo, i, k))))
    const react = RECEIVE.reactMs[0] + (RECEIVE.reactMs[1] - RECEIVE.reactMs[0]) * mulberry32(seedOf(poker.handNo, i, 'react'))()
    const collect = delays[1]! + flights[1][flights[1].length - 1].t + react
    const out = { x: spots[i].x - centre.x, y: spots[i].y - centre.y }
    const len = Math.hypot(out.x, out.y) || 1
    const towards = { x: out.x / len, y: out.y / len }
    return [0, 1].map((k) => receive(flights[k], holeOf(i, k as 0 | 1), collect - delays[k]!, towards, mulberry32(seedOf(poker.handNo, i, k, 'tap')))) as [Frame[], Frame[]]
  }
  const incomingBet = new Set(ghosts.filter((g) => g.kind === 'bet').map((g) => g.seat))
  const pushing = poker.phase === 'showdown' || poker.phase === 'muck'
  const puck = buttonAt >= 0 ? spots[buttonAt] : null

  return <main class="board poker-room">
    <div class="felt felt--board" ref={tableRef}>
      <div class="felt__lamp felt__lamp--centre" />
      {actor >= 0 && <div class="felt__lamp felt__lamp--seat" style={{ transform: `translate(${spots[actor].x}px, ${spots[actor].y}px) translate(-50%, -50%)` }} />}
      <svg class="felt-line" viewBox={`0 0 ${w || 1} ${h || 1}`} aria-hidden="true">
        {/* The betting line is sheared into the pile: a shadowed upper edge over a lighter, shorter-napped band. */}
        <ellipse class="felt-line__shade" cx={centre.x} cy={centre.y - 1} rx={ELLIPSE.rx * w * (1 - BET_IN) + cardW * 0.84} ry={ELLIPSE.ry * h * (1 - BET_IN) + cardW * 0.64} />
        <PaintPile id="line-pile" />
        <ellipse class="felt-line__sheen" filter="url(#line-pile)" cx={centre.x} cy={centre.y} rx={ELLIPSE.rx * w * (1 - BET_IN) + cardW * 0.84} ry={ELLIPSE.ry * h * (1 - BET_IN) + cardW * 0.64} />
      </svg>
      <div class="poker-logo" style={{ transform: `translate(${centre.x}px, ${centre.y + h * 0.01}px) translate(-50%, -50%)` }}>
        <FeltMark text="Party Buzzer" class="poker-logo__name" />
        <FeltMark text="No-limit Hold'em" class="poker-logo__game" />
      </div>

      {w > 0 && <div class="poker-layer" style={{ '--card-w': `${cardW}px` }}>
        {puck && <Piece key="puck" pose={{ x: puck.x + cardW * 1.5, y: puck.y, rot: 0 }} class="poker-piece--glide"><DealerPuck /></Piece>}

        {Array.from({ length: Math.max(0, poker.discard / 2 - folding) }, (_, i) =>
          <Piece key={`m${i}`} pose={{ ...muck, rot: muck.rot + ((i * 37) % 23) - 11, x: muck.x + ((i * 13) % 7) - 3 }}><PlayingCard card={null} up={false} /></Piece>)}

        {poker.board.map((card, i) => {
          const incoming = i >= down && !reducedMotion()
          const frames = incoming ? pitch(dealer, board(i), mulberry32(seedOf(poker.handNo, 'b', i))) : null
          return <Piece key={`${poker.handNo}-b${i}`} pose={board(i)} frames={frames} delay={incoming ? (i - down) * FLOP_GAP_MS : 0}>
            <PlayingCard card={card} up={i < down} class={five.size ? (five.has(card) ? 'poker-card--win' : 'poker-card--dim') : ''} />
          </Piece>
        })}

        {potTotal > 0 && !pushing && <Piece key="pot" pose={{ ...potAt, rot: 0 }}>
          <span class="poker-pot"><ChipStack amount={potTotal} />
            <span class="poker-pot__amount">{potTotal.toLocaleString()}</span>
            {poker.pots.length > 1 && <span class="poker-pot__side">{poker.pots.length - 1} side pot{poker.pots.length > 2 ? 's' : ''}</span>}
          </span>
        </Piece>}

        {seats.map((seat, i) => seat.busted || seat.folded ? null : ([0, 1] as const).map((k) => {
          const delay = dealDelay(i, k)
          const frames = dealtTo(i)?.[k] ?? null
          const won = winners.has(seat.player)
          const card = seat.cards?.[k] ?? null
          return <Piece key={`${poker.handNo}-${i}-${k}`} pose={holeOf(i, k)} frames={frames} delay={delay ?? 0}>
            <PlayingCard card={card} up={!!card} class={card && five.size ? (won && five.has(card) ? 'poker-card--win' : won ? '' : 'poker-card--dim') : ''} />
          </Piece>
        }))}

        {seats.map((seat, i) => seat.bet > 0 && <Piece key={`bet-${i}`} pose={{ ...betOf(i), rot: 0 }}>
          <span class="poker-bet">{!incomingBet.has(i) && <ChipStack amount={seat.bet} />}<span class="poker-bet__amount">{seat.bet.toLocaleString()}</span></span>
        </Piece>)}

        {ghosts.map((g) => <Piece key={g.key} pose={g.pose} frames={g.frames} done={() => setGhosts((all) => all.filter((other) => other.key !== g.key))}>
          {g.kind === 'fold' ? <PlayingCard card={null} up={false} /> : <ChipStack amount={g.amount ?? 0} />}
        </Piece>)}
      </div>}

      {seats.map((seat, i) => {
        const spot = spots[i]
        if (!spot) return null
        const last = lastBy.get(seat.player)
        const won = winners.has(seat.player)
        const odds = poker.equity?.[seat.player]
        return <div key={seat.player}
          class={`poker-seat ${seat.folded ? 'poker-seat--folded' : ''} ${seat.busted ? 'poker-seat--out' : ''}`}
          style={{ transform: `translate(${spot.x}px, ${spot.y}px) translate(-50%, -50%)`, '--id': colorForPlayer(state, seat.player) }}
        >
          <div key={won ? `w${poker.handNo}` : 'seat'} class={won ? 'fx-tada' : ''}>
            <p class="poker-seat__name">{nameOf(seat.player)}</p>
            <p class="poker-seat__stack">{seat.busted ? '' : seat.stack.toLocaleString()}</p>
            <p class="poker-seat__notes">
              {seat.sb && <span class="poker-seat__blind">Small blind</span>}
              {seat.bb && <span class="poker-seat__blind">Big blind</span>}
              {seat.away && <span class="poker-seat__away">Away</span>}
              {odds !== undefined && <span class="readout poker-odds">{Math.round(odds * 100)}%</span>}
            </p>
            {won && <Burst kind="stars" />}
          </div>
          {actor === i && poker.actBy && <ShotRing class="poker-seat__ring" until={poker.actBy} total={(seat.away ? 2 : session.options.shotSec) * 1000} now={now()} />}
          {last && !seat.busted && (last.kind === 'allIn'
            ? <span key={last.id} class="poker-allin fx-zoom">All in</span>
            : <span key={last.id} class="poker-seat__said fx-fade">{capital(feedLine(last, () => '').trim())}</span>)}
          {seat.busted && <span class="poker-seat__out fx-fade">{bustLine(poker.feed, seat.player)}</span>}
        </div>
      })}

      {handName && <div class="poker-handname" style={{ transform: `translate(${centre.x}px, ${centre.y + h * 0.075}px) translate(-50%, -50%)` }}>
        <Letters key={`${poker.handNo}-${handName}`} text={handName} />
      </div>}
      {floats.map((f) => {
        const i = seatIndex(f.player)
        if (i < 0 || !spots[i]) return null
        return <p key={f.key} class="poker-float fx-rise" style={{ left: `${spots[i].x}px`, top: `${spots[i].y - cardW}px`, '--id': colorForPlayer(state, f.player) }}>{f.text}</p>
      })}
      {banners.map((b) => <div key={b.key} class="poker-banner"><p class="poker-banner__text fx-zoom">{b.text}</p></div>)}
    </div>

    <header class="poker-hud">
      <span class="chip">{place}</span>
      <p class="poker-hud__blinds">Blinds <span class="poker-hud__num">{poker.sb} / {poker.bb}</span></p>
      <p class="poker-hud__next">Next level <span class="readout">{Math.floor(nextLevel / 60)}:{String(nextLevel % 60).padStart(2, '0')}</span></p>
      <p class="poker-hud__hand">Hand {poker.handNo}</p>
    </header>
    <aside class="poker-log" aria-label="Table log">
      <ol>{poker.feed.filter((entry) => entry.kind !== 'blind').slice(-LOG_LINES).map((entry) => <li key={entry.id} class="fx-fade">
        {entry.player && <span class="poker-log__who" style={{ color: colorForPlayer(state, entry.player) }}>{nameOf(entry.player)}</span>}
        {' '}{feedLine(entry, () => '').trim()}
      </li>)}</ol>
    </aside>
  </main>
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function bustLine(feed: PokerFeedEntry[], player: PlayerId): string {
  const entry = [...feed].reverse().find((e) => e.kind === 'bust' && e.player === player)
  return entry?.amount ? `Out in ${ordinal(entry.amount)}` : 'Out'
}
