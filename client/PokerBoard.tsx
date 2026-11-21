import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { play } from './sound.ts'
import type { PlayerId, PokerFeedEntry } from '../shared/protocol.ts'
import { REACT_LABEL } from '../shared/protocol.ts'
import { mulberry32 } from '../shared/random.ts'
import type { MinigameBoardProps } from './minigames.tsx'
import { JoinCode } from './JoinCode.tsx'
import { matchFrame } from './minigame-info.ts'
import { Burst, Letters } from './fx.tsx'
import { ChipStack, Corral, DealerPuck, LevelClock, FeltMark, PaintPile, Piece, PlayingCard, ShotRing, reducedMotion, usePokerCues, useSize, type PieceSound } from './PokerParts.tsx'
import { ELLIPSE, dealTimes, feedLine, holeRest, lie, seatPositions, seedOf, POKER_RULES } from './poker.ts'
import { chain, chipStack, gather, potOf, CHIP_FACE, flop, turnUp, pitch, receive, scatter, slide, street, sweep, toss, wildCard, RECEIVE, type Frame, type Pose, type PotStack } from './toss.ts'
import { colorForPlayer, ordinal, playerName, setlistPosition } from './ui.ts'

type Point = { x: number; y: number }
const DEALT: PieceSound = { air: 'poker-deal', tap: 'poker-tap' }
const DEALT_SECOND: PieceSound = { air: 'poker-deal' }
const LAID: PieceSound = { air: 'poker-deal', flip: 'poker-flip' }
const SHOWN: PieceSound = { flip: 'poker-flip' }
const FOLDED: PieceSound = { air: 'poker-fold' }
const BET: PieceSound = { stop: 'poker-chips' }
const SWEPT: PieceSound = { start: 'poker-sweep', stop: 'poker-chips' }
const PUSHED: PieceSound = { start: 'poker-sweep', stop: 'poker-push' }
const LINGER_MS = 800
const BANNER_MS = 2_600
const REACTION_MS = 1_800
const LOG_LINES = 7
const HOLE_IN = { across: 1.7, along: 1.75 }
const BET_BEYOND = 1.6
const KEEP_CLEAR = { across: 4, along: 1.6 }

const toward = (p: Point, c: Point, by: number): Point => ({ x: p.x + (c.x - p.x) * by, y: p.y + (c.y - p.y) * by })

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

type Ghost = { key: string; pose: Pose; frames: Frame[]; sound?: PieceSound; kind: 'fold' | 'chips' | 'bet'; amount?: number; chips?: number[]; corral?: { x: number; y: number; chips: number[] }[]; held?: number; pending?: number; seat?: number; popping?: boolean; stay?: boolean }

export function PokerBoard({ state, frame, now, join }: MinigameBoardProps) {
  const session = state.minigame!
  const poker = matchFrame(frame, 'poker', 'board', session.matchId)
  usePokerCues(poker, 'board')
  const shownPhase = useRef(session.phase)
  useEffect(() => {
    if (session.phase === 'results' && shownPhase.current !== 'results') play('leader')
    shownPhase.current = session.phase
  }, [session.phase])
  const nameOf = (id: PlayerId) => playerName(state, id)
  const place = setlistPosition(state) ?? 'Poker'
  const [tableRef, { w, h }] = useSize<HTMLDivElement>()

  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [banners, setBanners] = useState<{ key: string; text: string }[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); fn() }, ms)
    timers.current.add(timer)
  }
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer) }, [])
  const [floats, setFloats] = useState<{ key: string; player: PlayerId; text: string }[]>([])
  const laid = useRef<{ hand: number; cards: { frames: Frame[] | null; delay: number; hinge?: number }[]; busy: number } | null>(null)
  const seenDown = useRef<{ hand: number; cards: Set<string> }>({ hand: -1, cards: new Set() })
  if (poker && seenDown.current.hand !== poker.handNo) seenDown.current = { hand: poker.handNo, cards: new Set() }
  const deal = useRef<{ hand: number; at: number | null } | null>(null)
  if (poker && deal.current?.hand !== poker.handNo) deal.current = { hand: poker.handNo, at: deal.current || poker.phase === 'deal' ? performance.now() : null }
  const piles = useRef(new Map<number, { hand: number; street: string; total: number; chips: number[]; top: number }>())
  const pot = useRef<{ hand: number; total: number; stacks: PotStack[]; landing: { key: string; seat: number; stack: number; base: number; count: number; sent?: boolean }[]; wins: { id: number; seat: number; amount: number }[] }>({ hand: -1, total: 0, stacks: [], landing: [], wins: [] })
  const paths = useRef<{ key: string; deals: Map<number, [Frame[], Frame[]]>; shows: Map<number, ReturnType<typeof turnUp>> }>({ key: '', deals: new Map(), shows: new Map() })
  const pathKey = `${session.matchId}:${poker?.handNo}:${w}:${h}:${poker?.seats.map((s) => `${s.button}-${s.busted}`).join(',')}`
  if (paths.current.key !== pathKey) paths.current = { key: pathKey, deals: new Map(), shows: new Map() }
  const times = useMemo(() => poker ? dealTimes(poker.seats, poker.handNo) : new Map<number, [number, number]>(), [pathKey])
  const fresh = useFresh(poker?.feed, session.matchId)
  const freshReacts = useFresh(poker?.reactions, session.matchId)
  const prev = useRef<typeof poker>(null)

  const seats = poker?.seats ?? []
  const cardW = Math.round(Math.min(92, Math.max(44, w * 0.046)))
  const centre = { x: ELLIPSE.cx * w, y: ELLIPSE.cy * h }
  const spots = useMemo(() => seatPositions(seats.length).map((p) => ({ x: p.x * w, y: p.y * h })), [seats.length, w, h])
  const dealer = { x: centre.x, y: -cardW * 1.6 }
  const board = (i: number): Pose => {
    const hand = poker?.handNo ?? 0
    return { x: centre.x + (i - 2) * cardW * 1.14 + lie(cardW * 0.06, hand, 'bx', i), y: centre.y + lie(cardW * 0.05, hand, 'by', i), rot: lie(2, hand, 'b', i) }
  }
  const potAt = { x: centre.x + cardW * 3.8, y: centre.y }
  const chipW = cardW * 0.64
  const potStackAt = (stack: PotStack): Pose => ({ x: potAt.x + stack.x * chipW, y: potAt.y + stack.y * chipW * CHIP_FACE, rot: 0 })
  const pushPot = (): Ghost[] => {
    const { wins, stacks } = pot.current
    if (!wins.length) return []
    const owed = wins.map((win) => win.amount)
    const worth = (stack: PotStack) => stack.chips.reduce((a, b) => a + b, 0)
    const shares = wins.map((): PotStack[] => [])
    for (const stack of [...stacks].sort((a, b) => worth(b) - worth(a))) {
      const w = owed.indexOf(Math.max(...owed))
      owed[w] -= worth(stack)
      shares[w].push(stack)
    }
    const ghosts = shares.flatMap((share, w) => {
      if (!share.length) return []
      const bet = betOf(wins[w].seat)
      const to = { x: bet.x, y: bet.y, rot: 0 }
      const offset = (stack: PotStack) => ({ x: (stack.x - share[0].x) * chipW, y: (stack.y - share[0].y) * chipW * CHIP_FACE })
      const from = potStackAt(share[0])
      return [{ key: `w${wins[w].id}`, kind: 'chips' as const, stay: true, sound: PUSHED, corral: share.map((stack) => ({ ...offset(stack), chips: stack.chips })), pose: to, frames: slide(from, to, mulberry32(seedOf(wins[w].id)), { hand: 0.35, lift: 0, wobble: 0.03, skidTau: 200 }) }]
    })
    pot.current.wins = []
    pot.current.stacks = []
    return ghosts
  }
  const inward = (i: number) => {
    const dx = centre.x - spots[i].x
    const dy = centre.y - spots[i].y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len, across: Math.abs(dx / len) }
  }
  const into = (i: number, cards: { across: number; along: number }) => {
    const u = inward(i)
    return cardW * (cards.along + (cards.across - cards.along) * u.across)
  }
  const holeOf = (i: number, k: 0 | 1): Pose => {
    const u = inward(i)
    const reach = into(i, HOLE_IN)
    const at = { x: spots[i].x + u.x * reach, y: spots[i].y + u.y * reach }
    const tilt = ((spots[i].x - centre.x) / w) * -18
    return { x: at.x + (k ? 0.14 : -0.14) * cardW, y: at.y + (k ? 2 : 0), rot: tilt + holeRest(poker?.handNo ?? 0, i, k) }
  }
  const betOf = (i: number) => {
    const u = inward(i)
    const reach = into(i, HOLE_IN) + cardW * BET_BEYOND
    return { x: spots[i].x + u.x * reach, y: spots[i].y + u.y * reach }
  }
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
        const wild = wildCard(mulberry32(seedOf(entry.id, 'wild')))
        for (const k of [0, 1] as const) {
          const thrown = toss(holeOf(i, k), centre, entry.flick ?? null, mulberry32(seedOf(entry.id, k)), into(i, KEEP_CLEAR), k === wild)
          const end = thrown.frames[thrown.frames.length - 1]
          add.push({ key: `f${entry.id}-${k}`, kind: 'fold', sound: k ? undefined : FOLDED, pose: thrown.rest, frames: chain(thrown.frames, LINGER_MS + k * 60, [end]) })
        }
      }
      const bets = entry.kind === 'call' || entry.kind === 'bet' || entry.kind === 'raise' || entry.kind === 'allIn' || entry.kind === 'blind'
      if (bets && i >= 0 && motion) {
        const moved = (entry.amount ?? 0) - (before?.seats.find((seat) => seat.player === entry.player)?.bet ?? 0)
        if (moved > 0) {
          const to = { ...betOf(i), rot: 0 }
          const pile = piles.current.get(i)
          const chips = pile?.chips ?? chipStack(moved)
          add.push({ key: `c${entry.id}`, kind: 'bet', sound: BET, seat: i, chips, held: chips.length - (pile?.top ?? chips.length), pose: to, frames: slide({ ...toward(spots[i], centre, 0.12), rot: 0 }, to, mulberry32(entry.id), { hand: 0.4, lift: 0, wobble: 0.02 }) })
        }
      }
      if (entry.kind === 'win' && i >= 0 && motion) pot.current.wins.push({ id: entry.id, seat: i, amount: entry.amount ?? 0 })
      if (entry.kind === 'level') {
        const key = `l${entry.id}`
        setBanners((all) => [...all, { key, text: `Blinds ${Math.floor(entry.amount! / 2)} / ${entry.amount}` }])
        later(() => setBanners((all) => all.filter((b) => b.key !== key)), BANNER_MS)
      }
    }
    for (const land of pot.current.landing) {
      if (land.sent) continue
      land.sent = true
      const stack = pot.current.stacks[land.stack]
      add.push({ key: land.key, kind: 'chips', sound: SWEPT, chips: stack.chips, held: land.base, pending: stack.chips.length - land.base - land.count, pose: potStackAt(stack), frames: sweep({ ...betOf(land.seat), rot: 0 }, potStackAt(stack)) })
    }
    if (!pot.current.landing.length) add.push(...pushPot())
    const newHand = before && before.handNo !== poker.handNo
    if (add.length || newHand) setGhosts((all) => [...(newHand ? all.filter((g) => !g.stay) : all), ...add])
    if (freshReacts.length) {
      const items = freshReacts.map((r) => ({ key: `r${r.id}`, player: r.player, text: REACT_LABEL[r.kind] }))
      setFloats((all) => [...all, ...items])
      later(() => setFloats((all) => all.filter((f) => !items.some((item) => item.key === f.key))), REACTION_MS)
    }
  }, [poker, w, h])

  if (poker && w > 0) {
    const first = !laid.current
    if (laid.current?.hand !== poker.handNo) laid.current = { hand: poker.handNo, cards: [], busy: 0 }
    const table = laid.current
    const t = performance.now()
    while (table.cards.length < poker.board.length) {
      const at = table.cards.length
      if (first || reducedMotion()) { table.cards.push({ frames: null, delay: 0 }); continue }
      const start = Math.max(t, table.busy)
      const rand = mulberry32(seedOf(poker.handNo, 'b', at))
      const moves = at === 0 && poker.board.length >= 3
        ? flop(dealer, [0, 1, 2].map(board), cardW, rand)
        : (({ frames, hinge }) => ({ frames: [frames], hinge }))(street(dealer, board(at), cardW, rand))
      for (const frames of moves.frames) table.cards.push({ frames, delay: start - t, hinge: moves.hinge })
      table.busy = start + Math.max(...moves.frames.map((f) => f[f.length - 1].t))
    }
  }

  if (poker) {
    const swept: { seat: number; chips: number[]; amount: number }[] = []
    poker.seats.forEach((seat, i) => {
      let pile = piles.current.get(i)
      if (pile && (pile.hand !== poker.handNo || (pile.street !== poker.street && seat.bet))) {
        if (pile.hand === poker.handNo) swept.push({ seat: i, chips: pile.chips, amount: pile.total })
        piles.current.delete(i)
        pile = undefined
      }
      if (seat.bet === (pile?.total ?? 0)) return
      if (!seat.bet) {
        swept.push({ seat: i, chips: pile!.chips, amount: pile!.total })
        piles.current.delete(i)
        return
      }
      const onTop = pile && seat.bet > pile.total
      const add = chipStack(seat.bet - (onTop ? pile!.total : 0))
      piles.current.set(i, { hand: poker.handNo, street: poker.street, total: seat.bet, chips: onTop ? [...pile!.chips, ...add] : add, top: add.length })
    })
    const total = poker.pots.reduce((a, b) => a + b, 0)
    if (pot.current.hand !== poker.handNo) pot.current = { hand: poker.handNo, total: 0, stacks: [], landing: [], wins: [] }
    const table = pot.current
    if (table.total !== total) {
      const rand = mulberry32(seedOf(poker.handNo, poker.street, table.total, 'pot'))
      if (total < table.total || (!table.total && !swept.length)) {
        table.stacks = potOf(total, rand)
        table.landing = []
      } else {
        const missed = total - table.total - swept.reduce((a, b) => a + b.amount, 0)
        const bets = [...swept.map((bet) => bet.chips), ...(missed > 0 ? [chipStack(missed)] : [])]
        const { pot: stacks, onto } = gather(table.stacks, bets, rand)
        if (!reducedMotion()) {
          const height = table.stacks.map((stack) => stack.chips.length)
          swept.forEach((bet, k) => {
            const base = height[onto[k]] ?? 0
            height[onto[k]] = base + bet.chips.length
            table.landing.push({ key: `s${poker.handNo}-${table.total}-${bet.seat}`, seat: bet.seat, stack: onto[k], base, count: bet.chips.length })
          })
        }
        table.stacks = stacks
      }
      table.total = total
    }
  }

  if (session.phase === 'results') {
    const rows = [...session.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
    const winner = rows[0]
    return <main class="board poker-room">
      <div class="felt felt--board"><div class="felt__lamp felt__lamp--centre" aria-hidden="true" />
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
        {join && <JoinCode small />}
      </div>
    </main>
  }

  if (!poker) return <main class="board poker-room">
    <div class="felt felt--board"><div class="felt__lamp felt__lamp--centre" aria-hidden="true" />
      <section class="poker-final">
        <FeltMark text="Party Buzzer" class="poker-logo__name" />
        <FeltMark text="No-limit Hold'em" class="poker-logo__game" />
        <p class="poker-waiting">{session.phase === 'ready' ? (session.checkpoint ? `Resumes from ${session.checkpoint.label}` : 'Next up') : 'Shuffling up'}</p>
        <p class="poker-rules">{POKER_RULES}</p>
      </section>
      {join && <JoinCode small />}
    </div>
  </main>

  const lastBy = new Map<PlayerId, PokerFeedEntry>()
  const blindAt = poker.feed.findLastIndex((entry) => entry.kind === 'blind')
  const handStart = blindAt > 0 && poker.feed[blindAt - 1].kind === 'blind' ? blindAt - 1 : Math.max(0, blindAt)
  for (const entry of poker.feed.slice(handStart)) if (entry.player && entry.kind !== 'win' && entry.kind !== 'bust') lastBy.set(entry.player, entry)
  const winners = new Set(poker.showdown?.flatMap((pot) => pot.winners) ?? [])
  const five = new Set(poker.showdown?.[0]?.five ?? [])
  const handName = poker.showdown?.[0]?.name
  const potTotal = poker.pots.reduce((a, b) => a + b, 0)
  const actor = seatIndex(poker.actor)
  const buttonAt = seats.findIndex((seat) => seat.button)

  const pitches = [...times.values()].flat().sort((a, b) => a - b)
  const dealtAt = deal.current?.at ?? null
  const dealDelay = (i: number, k: 0 | 1) => {
    const at = times.get(i)?.[k]
    return dealtAt === null || at === undefined ? null : Math.max(0, dealtAt + at - performance.now())
  }
  const dealtTo = (i: number): [Frame[], Frame[]] | null => {
    if (dealtAt === null || !times.has(i)) return null
    const cached = paths.current.deals.get(i)
    if (cached) return cached
    const delays = times.get(i)!
    const flights = ([0, 1] as const).map((k) => pitch(dealer, scatter(holeOf(i, k), cardW, mulberry32(seedOf(poker.handNo, i, k, 'land'))), mulberry32(seedOf(poker.handNo, i, k))))
    const react = RECEIVE.reactMs[0] + (RECEIVE.reactMs[1] - RECEIVE.reactMs[0]) * mulberry32(seedOf(poker.handNo, i, 'react'))()
    const collect = delays[1]! + flights[1][flights[1].length - 1].t + react
    const pair = ([0, 1] as const).map((k) => {
      const lands = flights[k][flights[k].length - 1].t
      const pitched = pitches.indexOf(times.get(i)![k])
      return receive(flights[k], holeOf(i, k), collect - delays[k]!, mulberry32(seedOf(poker.handNo, i, 'tap')))
        .map((f) => ({ ...f, z: f.t < lands ? 10 + pitched : 2 }))
    }) as [Frame[], Frame[]]
    paths.current.deals.set(i, pair)
    return pair
  }
  const incomingBet = new Set(ghosts.filter((g) => g.kind === 'bet').map((g) => g.seat))
  const pushing = poker.phase === 'showdown' || poker.phase === 'muck'
  const puck = buttonAt >= 0 ? (({ x, y }, u) => ({ x: x - u.y * cardW * 1.35, y: y + u.x * cardW * 1.35 }))(holeOf(buttonAt, 0), inward(buttonAt)) : null
  const lineRx = ELLIPSE.rx * w * 0.66
  const lineRy = ELLIPSE.ry * h * 0.6

  return <main class="board poker-room">
    <div class="felt felt--board" ref={tableRef}>
      <div class="felt__lamp felt__lamp--centre" aria-hidden="true" />
      {actor >= 0 && <div class="felt__lamp felt__lamp--seat" aria-hidden="true" style={{ transform: `translate(${spots[actor].x}px, ${spots[actor].y}px) translate(-50%, -50%)` }} />}
      <svg class="felt-line" viewBox={`0 0 ${w || 1} ${h || 1}`} aria-hidden="true">
        <ellipse class="felt-line__shade" cx={centre.x} cy={centre.y - 1} rx={lineRx} ry={lineRy} />
        <PaintPile id="line-pile" />
        <ellipse class="felt-line__sheen" filter="url(#line-pile)" cx={centre.x} cy={centre.y} rx={lineRx} ry={lineRy} />
      </svg>
      <div class="poker-logo" style={{ transform: `translate(${centre.x}px, ${centre.y + h * 0.01}px) translate(-50%, -50%)` }}>
        <FeltMark text="Party Buzzer" class="poker-logo__name" />
        <FeltMark text="No-limit Hold'em" class="poker-logo__game" />
      </div>

      {w > 0 && <div class="poker-layer" style={{ '--card-w': `${cardW}px`, '--lamp-x': centre.x, '--lamp-y': centre.y, '--lamp-reach': Math.hypot(w, h) / 2 }}>
        {puck && <Piece key="puck" pose={{ ...puck, rot: 0 }} class="poker-piece--glide"><DealerPuck /></Piece>}

        {poker.board.map((card, i) => {
          const move = laid.current?.cards[i]
          return <Piece key={`${poker.handNo}-b${i}`} pose={board(i)} frames={move?.frames} delay={move?.delay} sound={i === 1 || i === 2 ? undefined : LAID}>
            <PlayingCard card={card} up hinge={move?.hinge} class={five.size ? (five.has(card) ? 'poker-card--win' : 'poker-card--dim') : ''} />
          </Piece>
        })}

        {potTotal > 0 && (!pushing || pot.current.landing.length > 0 || fresh.some((entry) => entry.kind === 'win')) && <>
          <Piece key={`pot-${poker.handNo}`} pose={{ ...potAt, rot: 0 }}>
            <Corral at={potAt} lamp={centre} chipW={chipW} stacks={pot.current.stacks.map((stack, k) => {
              const landing = pot.current.landing.filter((land) => land.stack === k)
              const { x, y } = potStackAt(stack)
              return { x: x - potAt.x, y: y - potAt.y, chips: stack.chips, pending: landing.length ? stack.chips.length - Math.min(...landing.map((land) => land.base)) : 0 }
            })} />
          </Piece>
          <Piece key="pot" pose={{ x: potAt.x, y: potAt.y + chipW * 1.9, rot: 0 }}>
            <span class="poker-pot">
              <span class="poker-pot__amount">{potTotal.toLocaleString()}</span>
              {poker.pots.length > 1 && <span class="poker-pot__side">{poker.pots.length - 1} side pot{poker.pots.length > 2 ? 's' : ''}</span>}
            </span>
          </Piece>
        </>}

        {seats.map((seat, i) => seat.busted || seat.folded ? null : ([0, 1] as const).map((k) => {
          const delay = dealDelay(i, k)
          const frames = dealtTo(i)?.[k] ?? null
          const won = winners.has(seat.player)
          const card = seat.cards?.[k] ?? null
          if (!card) seenDown.current.cards.add(`${i}-${k}`)
          if (card && seenDown.current.cards.has(`${i}-${k}`) && !reducedMotion()) {
            let pair = paths.current.shows.get(i)
            if (!pair) { pair = turnUp([holeOf(i, 0), holeOf(i, 1)], centre, cardW); paths.current.shows.set(i, pair) }
            const shown = pair[k]
            return <Piece key={`${poker.handNo}-${i}-${k}-up`} pose={shown.rest} frames={shown.frames} sound={k ? undefined : SHOWN}>
              <PlayingCard card={card} up hinge={shown.hinge} class={five.size ? (won && five.has(card) ? 'poker-card--win' : won ? '' : 'poker-card--dim') : ''} />
            </Piece>
          }
          return <Piece key={`${poker.handNo}-${i}-${k}`} pose={holeOf(i, k)} frames={frames} delay={delay ?? 0} sound={k ? DEALT_SECOND : DEALT} class={frames ? 'poker-piece--dealt' : ''}>
            <PlayingCard card={card} up={!!card} class={card && five.size ? (won && five.has(card) ? 'poker-card--win' : won ? '' : 'poker-card--dim') : ''} />
          </Piece>
        }))}

        {seats.map((seat, i) => seat.bet > 0 && <Piece key={`bet-${i}`} pose={{ ...betOf(i), rot: 0 }}>
          <span class="poker-bet">{(({ chips, top } = piles.current.get(i) ?? { chips: chipStack(seat.bet), top: 0 }) =>
            <ChipStack chips={chips} pending={incomingBet.has(i) ? top : 0} />)()}<span class="poker-bet__amount">{seat.bet.toLocaleString()}</span></span>
        </Piece>)}

        {ghosts.map((g) => {
          const gone = () => setGhosts((all) => all.filter((other) => other.key !== g.key))
          const arrived = g.kind === 'fold' ? () => (play('poker-poof'), setGhosts((all) => all.map((other) => other.key === g.key ? { ...other, popping: true } : other))) : g.stay ? undefined : () => {
            pot.current.landing = pot.current.landing.filter((land) => land.key !== g.key)
            const pushed = pot.current.landing.length ? [] : pushPot()
            setGhosts((all) => [...all.filter((other) => other.key !== g.key), ...pushed])
          }
          return <Piece key={g.key} pose={g.pose} frames={g.frames} sound={g.sound} done={arrived}>
            {g.kind === 'fold'
              ? <span class={`poker-fold ${g.popping ? 'fx-poof' : ''}`} onAnimationEnd={g.popping ? gone : undefined}><PlayingCard card={null} up={false} /></span>
              : g.kind === 'bet'
                ? <span class="poker-bet"><ChipStack chips={g.chips} held={g.held} /><span class="poker-bet__amount" style={{ visibility: 'hidden' }}>{seats[g.seat!]?.bet.toLocaleString()}</span></span>
                : g.corral
                  ? <Corral stacks={g.corral} at={g.pose} lamp={centre} chipW={chipW} />
                  : <ChipStack amount={g.amount} chips={g.chips} held={g.held} pending={g.pending} />}
          </Piece>
        })}
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
          {actor === i && poker.actBy && <ShotRing class="poker-seat__ring" until={poker.actBy} total={(seat.away ? 2 : session.options.shotSec) * 1000} now={now} />}
          {last && !seat.busted && (last.kind === 'allIn'
            ? <span key={last.id} class="poker-allin fx-zoom">All in</span>
            : <span key={last.id} class="poker-seat__said fx-fade">{capital(feedLine(last, () => '').trim())}</span>)}
          {seat.busted && <span class="poker-seat__out fx-fade">{seat.place ? `Out in ${ordinal(seat.place)}` : 'Out'}</span>}
        </div>
      })}

      {handName && <div class="poker-handname" style={{ transform: `translate(${centre.x}px, ${centre.y + cardW * 1.25}px) translate(-50%, -50%)` }}>
        <Letters key={`${poker.handNo}-${handName}`} text={handName} />
      </div>}
      {floats.map((f) => {
        const i = seatIndex(f.player)
        if (i < 0 || !spots[i]) return null
        return <p key={f.key} class="poker-float fx-rise" style={{ left: `${spots[i].x}px`, top: `${spots[i].y - cardW}px`, '--id': colorForPlayer(state, f.player) }}>{f.text}</p>
      })}
      {banners.map((b) => <div key={b.key} class="poker-banner"><p class="poker-banner__text fx-zoom">{b.text}</p></div>)}
      {join && <JoinCode small />}
    </div>

    <header class="poker-hud">
      <span class="chip">{place}</span>
      <p class="poker-hud__blinds">Blinds <span class="poker-hud__num">{poker.sb} / {poker.bb}</span></p>
      <p class="poker-hud__next">Next level <LevelClock until={poker.nextLevelAt} now={now} /></p>
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
