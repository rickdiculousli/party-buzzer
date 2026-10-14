import { useEffect, useRef, useState } from 'preact/hooks'
import type { MinigameFrame, PokerFeedEntry, PokerShared, State } from '../../shared/protocol.ts'
import { pokerDealSpan } from '../../shared/protocol.ts'
import { PokerBoard } from '../PokerBoard.tsx'
import { PokerPlayer } from '../PokerPlayer.tsx'

const players = ['Ada', 'Bo', 'Cy', 'Dee', 'Eve', 'Fen', 'Gus', 'Hal'].map((name, i) => ({ id: `p${i}`, name, connected: true }))
const state: State = {
  grouping: 'solo', readingActive: false, players, teams: [], scores: {},
  game: { id: 'trivia', options: {}, moduleState: {} }, items: {}, effects: [], games: [], duelRules: [],
  setlists: [], packs: [], packSizes: {}, packCost: {}, mirrorFragments: false, answerWindowSec: 10, choiceSec: 20,
  autoplay: { on: false, nextSec: 5, buzzSec: 10, reboundSec: 4, introSec: 12 },
  round: { questionId: '', attemptId: '', value: 100, phase: 'IDLE', armedAt: 0, order: [], total: 0, lockedOut: [] },
  minigame: { id: 'poker', matchId: 'motion-poker', phase: 'playing', participants: players.map((p) => p.id), options: { durationSec: 40, seed: 1, shotSec: 30 } },
}
const table = (handNo: number): PokerShared => ({
  phase: 'bet', street: 'preflop', handNo, sb: 25, bb: 50, actor: 'p0', actBy: Date.now() + 30_000, nextLevelAt: Date.now() + 60_000,
  seats: players.map((p, i) => ({ player: p.id, stack: 1500, bet: 0, button: i === 7, sb: i === 0, bb: i === 1,
    folded: false, allIn: false, busted: false, place: null, away: false, cards: null })),
  board: [], pots: [], showdown: null, equity: null, runout: false, feed: [], reactions: [],
})

/** Real surfaces, synthetic pushes: never connects to or changes the room. */
export function PokerStress({ lead, surface }: { lead: boolean; surface: 'board' | 'phone' }) {
  const [source, setSource] = useState(() => table(1))
  const [delivered, setDelivered] = useState(source)
  const [cadence, setCadence] = useState(0)
  const hand = useRef(1)
  const current = useRef(source)
  current.current = source
  useEffect(() => { setDelivered(source) }, [source])
  useEffect(() => {
    if (!cadence) return
    const timer = setInterval(() => setDelivered({ ...current.current }), cadence)
    return () => clearInterval(timer)
  }, [cadence])
  useEffect(() => {
    if (lead) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    const next = table(++hand.current)
    next.phase = 'deal'; next.actor = null; next.actBy = null
    setSource(next)
    const dealt = pokerDealSpan(players.length) + 1800
    later(dealt, () => setSource((s) => ({ ...s, phase: 'bet', actor: 'p0', actBy: Date.now() + 30_000 })))
    for (let i = 0; i < players.length; i++) later(dealt + 500 + i * 200, () => setSource((s) => ({ ...s,
      seats: s.seats.map((seat, k) => k === i ? { ...seat, bet: 137 + i * 50, stack: seat.stack - 137 - i * 50 } : seat),
      actor: players[(i + 1) % players.length].id,
      feed: [...s.feed, { id: i + 1, player: players[i].id, kind: 'bet', amount: 137 + i * 50 }],
    })))
    later(dealt + 2600, () => setSource((s) => ({ ...s, phase: 'reveal', actor: null, actBy: null,
      pots: [s.seats.reduce((sum, seat) => sum + seat.bet, 0)], seats: s.seats.map((seat) => ({ ...seat, bet: 0 })) })))
    later(dealt + 3800, () => setSource((s) => ({ ...s, phase: 'showdown', street: 'river', board: ['Ah', 'Kd', '7c', 'Qs', '2d'],
      seats: s.seats.map((seat, i) => ({ ...seat, cards: i === 0 ? ['As', 'Ac'] : ['Jh', 'Tc'] })),
      showdown: [{ winners: ['p0'], name: 'Three of a kind', five: ['Ah', 'As', 'Ac', 'Kd', 'Qs'], amount: s.pots[0] }],
      feed: [...s.feed, { id: 9, player: 'p0', kind: 'win', amount: s.pots[0], hand: 'Three of a kind' } as PokerFeedEntry],
    })))
    return () => { for (const timer of timers) clearTimeout(timer) }
  }, [lead])
  const frame: MinigameFrame = surface === 'board'
    ? { ...delivered, id: 'poker', matchId: 'motion-poker', role: 'board', tick: 0, serverTime: Date.now() }
    : { ...delivered, id: 'poker', matchId: 'motion-poker', role: 'player', tick: 0, serverTime: Date.now(), hole: ['As', 'Ac'], place: null, canShow: false,
      legal: delivered.actor === 'p0' ? { canCheck: true, call: 0, canRaise: true, canAllIn: true, minTo: 100, maxTo: 1500 } : null }
  return <div class={`poker-stress poker-stress--${surface}`}>
    <label class="harness__check">Frame delivery <select class="input" value={cadence} onChange={(e) => setCadence(Number(e.currentTarget.value))}>
      <option value={0}>On table changes</option><option value={16}>Every 16ms</option><option value={50}>Every 50ms</option><option value={250}>Every 250ms</option>
    </select></label>
    <div class="poker-stress__surface">
      {surface === 'board' ? <PokerBoard state={state} frame={frame} now={Date.now} touches={[]} /> : <PokerPlayer state={state} frame={frame} now={Date.now}
        playerId="p0" connected send={(msg) => {
          if (msg.t === 'minigameInput' && msg.input.kind === 'fold') setSource((s) => ({ ...s, seats: s.seats.map((seat, i) => i === 0 ? { ...seat, folded: true } : seat) }))
        }} ack={null} touches={[]} />}
    </div>
  </div>
}
