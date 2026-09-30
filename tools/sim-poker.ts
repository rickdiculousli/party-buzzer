/**
 * Synthetic self-play for Poker. Six bots join and play a fast tournament to
 * one winner: small stacks, one-minute levels and a five-second shot clock.
 * Fay never acts, so the shot clock plays her hands. Folds send a flick, so the
 * board shows flights. Every betting beat checks that no chip appeared or
 * vanished. A Poker match already stopped with a checkpoint resumes instead of
 * starting over.
 *
 *   npm run sim-poker
 *   npm run sim-poker -- 300                  one bot look every 0.3 s
 *   npm run sim-poker -- 300 http://box:8080
 *
 * The match ends on its own; Ctrl-C stops it, which keeps the checkpoint, and
 * the bots leave.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable } from './conn.ts'
import type { PokerInput } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const TICK_MS = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 400)
const URL = await reachable(args.find((arg) => arg.startsWith('http')))
const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay']
const IDLE = 'Fay'
const OPTIONS = { stack: 500, bigBlind: 20, levelMin: 1, shotSec: 5 }
const REACTS = ['nice', 'ouch', 'bluff', 'wow'] as const
const RESULTS_MS = 8_000

const host = await connect(URL, 'host')
const bots = []
for (const name of NAMES) {
  const conn = await connect(URL, 'player', name, `sim-poker-${name}`)
  bots.push({ conn, name, seq: Date.now() })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  for (const bot of bots) bot.conn.close()
  console.log('Stopped; Start on the host resumes from the last hand.')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)

const session = host.state()?.minigame
if (session?.id === 'poker' && session.phase === 'ready' && session.checkpoint) {
  console.log(`Resuming from ${session.checkpoint.label}`)
} else {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'poker', options: OPTIONS } })
  await host.waitFor((s) => s.minigame?.id === 'poker' && s.minigame.phase === 'ready' && !s.minigame.checkpoint)
}
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
    if (!legal || bot.name === IDLE) continue
    const roll = Math.random()
    if (roll < 0.2 && !legal.canCheck) send({ kind: 'fold', flick: { dx: Math.random() - 0.5, dy: -1, speed: 0.3 + Math.random() * 0.7 } })
    else if (roll < 0.75) send({ kind: legal.canCheck ? 'check' : 'call' })
    else if (roll < 0.95 && legal.canRaise) send({ kind: 'raise', to: legal.minTo })
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
