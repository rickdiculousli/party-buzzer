/**
 * Synthetic self-play for the tug of war minigame. Fills the room with bots that
 * tap at personal rhythms (steady, masher, bursty, lazy), so you can watch the
 * rope on the board through real matches.
 *
 * Like `sim.ts` it is an ordinary client over real sockets.
 *
 *   npm run sim-tug                        endless 30-second matches
 *   npm run sim-tug -- 3                   stop after three matches
 *   npm run sim-tug -- 3 20                three 20-second matches
 *   npm run sim-tug -- 3 20 http://box:8080
 *
 * Ctrl-C cancels the match and removes the bots, so your real game is left clean.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import { link } from '../server/net.ts'

const [argMatches, argSeconds, argUrl] = process.argv.slice(2)
const MATCHES = Number(argMatches ?? Infinity)
const SECONDS = Number(argSeconds ?? 30)
const URL = await reachable(argUrl)

type Bot = {
  name: string
  /** Taps a second while pulling. */
  rate: number
  /** Bursty bots tap in bursts of this many ms with this many ms of rest between. */
  burst?: { onMs: number; offMs: number }
  conn?: Conn
  seq: number
}

const ROSTER: Omit<Bot, 'seq'>[] = [
  { name: 'Nia', rate: 3 }, // steady
  { name: 'Owen', rate: 9 }, // masher
  { name: 'Priya', rate: 6, burst: { onMs: 1500, offMs: 1500 } }, // bursty
  { name: 'Sam', rate: 1.5 }, // lazy
  { name: 'Tess', rate: 3 },
  { name: 'Wes', rate: 8, burst: { onMs: 800, offMs: 2200 } },
]

const log = (s = '') => console.log(s)

async function play(bot: Bot, matchId: string, startsAt: number, endsAt: number) {
  const conn = bot.conn!
  await sleep(Math.max(0, startsAt - conn.now()) + Math.random() * 300)
  const began = conn.now()
  while (conn.now() < endsAt) {
    const cycle = bot.burst ? bot.burst.onMs + bot.burst.offMs : 0
    const resting = bot.burst && (conn.now() - began) % cycle >= bot.burst.onMs
    if (!resting) conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { kind: 'pull' } })
    await sleep((1000 / bot.rate) * (0.7 + Math.random() * 0.6))
  }
}

async function main() {
  log(`\n  Party Buzzer — tug of war self-play against ${link(URL)}`)
  log(`  ${SECONDS}-second matches${MATCHES === Infinity ? '' : `, ${MATCHES} of them`}  ·  Ctrl-C to stop\n`)

  const host = await connect(URL, 'host')
  const bots: Bot[] = []
  for (const spec of ROSTER) {
    const bot: Bot = { ...spec, seq: Date.now() }
    bot.conn = await connect(URL, 'player', bot.name)
    bots.push(bot)
    await sleep(40)
  }
  log(`  ${bots.length} bots in the room: ${bots.map((b) => b.name).join(', ')}`)

  const cleanup = () => {
    host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    host.send({ t: 'host', action: { a: 'closeMinigame' } })
    host.send({ t: 'host', action: { a: 'next' } })
    for (const bot of bots) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn!.playerId } })
    log('\n  match closed, bots removed.\n')
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', cleanup)

  if (host.state()?.round.phase !== 'IDLE') {
    host.send({ t: 'host', action: { a: 'next' } })
    await host.waitFor((s) => s.round.phase === 'IDLE')
  }
  const names = (id: string) => host.state()?.players.find((p) => p.id === id)?.name ?? '?'

  for (let m = 1; m <= MATCHES; m++) {
    const previous = host.state()?.minigame?.matchId
    if (host.state()?.minigame?.phase === 'playing' || host.state()?.minigame?.phase === 'countdown') {
      host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    }
    host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'tug', options: { durationSec: SECONDS } } })
    await host.waitFor((s) => s.minigame?.phase === 'ready' && s.minigame.matchId !== previous)
    host.send({ t: 'host', action: { a: 'startMinigame' } })
    const session = (await host.waitFor((s) => s.minigame?.phase === 'countdown')).minigame!
    log('')
    log(`  ── Match ${m}  ·  ${session.participants.length} players`)

    const playing = bots
      .filter((bot) => session.participants.includes(bot.conn!.playerId))
      .map((bot) => play(bot, session.matchId, session.startsAt!, session.endsAt!))
    await Promise.all(playing)

    const done = await host.waitFor(
      (s) => s.minigame?.phase === 'results' || s.minigame?.matchId !== session.matchId,
      SECONDS * 1000 + 10_000,
    )
    if (done.minigame?.phase !== 'results') {
      log('     match was cancelled')
      break
    }
    for (const result of done.minigame.results ?? []) {
      log(`     ${names(result.playerId).padEnd(6)} ${String(result.points).padStart(4)} pts`)
    }
    await sleep(4000)
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
