/**
 * Synthetic self-play for Poker. Six bots join and play a fast tournament to
 * one winner: small stacks, one-minute levels and a five-second shot clock.
 * Fay never acts until three are left, so the shot clock plays her hands; the
 * last three shove often so the match finishes. Folds send a flick, so the
 * board shows flights. Every betting beat checks that no chip appeared or
 * vanished.
 *
 *   npm run sim-poker
 *   npm run sim-poker -- 300                  one bot look every 0.3 s
 *   npm run sim-poker -- 300 http://box:8080
 *
 * Solo plays heads-up against you: join a phone first, then one bot (Ada) takes
 * the other seat at the default stack, blinds and 30-second shot clock, and
 * acts after about 1.5 s. Your phone is never kicked.
 *
 *   npm run sim-poker -- solo
 *   npm run sim-poker -- solo 3000            Ada takes about 3 s per action
 *
 * The match ends on its own; Ctrl-C stops it, clears the Poker session and its
 * checkpoint, and the bots leave.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable } from './conn.ts'
import type { PokerInput } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const SOLO = args.includes('solo')
const TICK_MS = Number(args.find((arg) => /^\d+$/.test(arg)) ?? (SOLO ? 1500 : 400))
const URL = await reachable(args.find((arg) => arg.startsWith('http')))
const NAMES = SOLO ? ['Ada'] : ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay']
const IDLE = 'Fay'
const OPTIONS = SOLO
  ? { stack: 1500, bigBlind: 20, levelMin: 10, shotSec: 30 }
  : { stack: 500, bigBlind: 20, levelMin: 1, shotSec: 5 }
const REACTS = ['nice', 'ouch', 'bluff', 'wow'] as const
const RESULTS_MS = 8_000

const host = await connect(URL, 'host')
if (SOLO && !host.state()?.players.some((p) => p.connected && !p.id.startsWith('sim-poker-'))) {
  console.error('Solo needs your phone: join the room first, then run this again.')
  process.exit(1)
}
const bots = []
for (const name of NAMES) {
  const conn = await connect(URL, 'player', name, `sim-poker-${name}`)
  bots.push({ conn, name, seq: Date.now() })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  for (const bot of bots) {
    bot.conn.close()
    host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
  }
  console.log('Stopped; Poker cleared.')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)

host.send({ t: 'host', action: { a: 'cancelMinigame' } })
host.send({ t: 'host', action: { a: 'closeMinigame' } })
host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'poker', options: OPTIONS } })
await host.waitFor((s) => s.minigame?.id === 'poker' && s.minigame.phase === 'ready' && !s.minigame.checkpoint)
host.send({ t: 'host', action: { a: 'startMinigame' } })
await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = host.state()!.minigame!.matchId
const total = OPTIONS.stack * host.state()!.minigame!.participants.length
const names = new Map(host.state()?.players.map((p) => [p.id, p.name]))

let hand = 0
let failures = 0
while (host.state()?.minigame?.phase === 'playing') {
  for (const bot of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'poker' || frame.matchId !== matchId) continue
    if (frame.handNo !== hand) {
      hand = frame.handNo
      const stacks = frame.seats.filter((seat) => !seat.busted).map((seat) => `${names.get(seat.player)} ${seat.stack + seat.bet}`)
      console.log(`Hand ${hand} · blinds ${frame.sb}/${frame.bb} · ${stacks.join(', ')}`)
    }
    if (frame.phase === 'bet') {
      const chips = frame.seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0) + frame.pots.reduce((a, b) => a + b, 0)
      if (chips !== total) {
        failures++
        console.error(`Chips drifted in hand ${frame.handNo}: ${chips} of ${total}`)
      }
    }
    const send = (input: { kind: PokerInput['kind'] } & Record<string, unknown>) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as PokerInput })
    if (Math.random() < 0.02) send({ kind: 'react', react: REACTS[Math.floor(Math.random() * REACTS.length)] })
    if (frame.canShow && Math.random() < 0.5) send({ kind: 'show' })
    const legal = frame.legal
    // Down to the last three, Fay wakes up and everyone shoves more, so the match finishes.
    const late = !SOLO && frame.seats.filter((seat) => !seat.busted).length <= 3
    if (!legal || (bot.name === IDLE && !late)) continue
    const roll = Math.random()
    // Solo, the bot bets and raises a lot and often over the pot, so the call strip's overbet shows.
    if (SOLO && roll > 0.35 && legal.canRaise) {
      const pot = frame.pots.reduce((a, b) => a + b, 0) + frame.seats.reduce((a, seat) => a + seat.bet, 0)
      const highBet = Math.max(0, ...frame.seats.map((seat) => seat.bet))
      const size = [0.5, 1, 1.5, 2, 2.5][Math.floor(Math.random() * 5)]
      const to = Math.max(legal.minTo, Math.round(highBet + size * (pot + legal.call)))
      send(to >= legal.maxTo ? { kind: 'allIn' } : { kind: 'raise', to })
      continue
    }
    if (roll < 0.2 && !legal.canCheck) send({ kind: 'fold', flick: { dx: Math.random() - 0.5, dy: -1, speed: 0.3 + Math.random() * 0.7 } })
    else if (roll < (late ? 0.5 : 0.75)) send({ kind: legal.canCheck ? 'check' : 'call' })
    else if (roll < (late ? 0.65 : 0.95) && legal.canRaise) send({ kind: 'raise', to: legal.minTo })
    else send({ kind: 'allIn' })
  }
  await sleep(TICK_MS)
}

const results = [...host.state()?.minigame?.results ?? []].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
for (const result of results) console.log(`${result.place}. ${names.get(result.playerId) ?? result.playerId}`)
console.log(failures ? `${failures} chip checks failed` : 'Chips held on every check.')
await sleep(RESULTS_MS)
host.send({ t: 'host', action: { a: 'closeMinigame' } })
for (const bot of bots) {
  bot.conn.close()
  host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
}
setTimeout(() => process.exit(failures ? 1 : 0), 200)
