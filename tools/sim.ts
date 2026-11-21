import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import { link } from '../server/net.ts'
import type { State } from '../shared/protocol.ts'

const argv = process.argv.slice(2)
const gi = argv.indexOf('--game')
const GAME = gi >= 0 ? argv[gi + 1] : process.env.GAME
const positional = argv.filter((a, i) => a !== '--game' && i !== gi + 1)
const [argRounds, argPace, argUrl] = positional
const ROUNDS = Number(argRounds ?? process.env.ROUNDS ?? Infinity)
const PACE = Number(argPace ?? process.env.PACE ?? 1)
const URL = await reachable(argUrl ?? process.env.URL)

const beat = (ms: number) => sleep(ms * PACE)

type Bot = {
  name: string
  skill: number
  reflex: number
  jitter: number
  lag: number
  conn?: Conn
}

const ROSTER: Bot[] = [
  { name: 'Nia', skill: 0.85, reflex: 190, jitter: 35, lag: 8 },
  { name: 'Owen', skill: 0.55, reflex: 210, jitter: 40, lag: 12 },
  { name: 'Priya', skill: 0.75, reflex: 250, jitter: 30, lag: 60 },
  { name: 'Sam', skill: 0.45, reflex: 175, jitter: 90, lag: 10 },
  { name: 'Tess', skill: 0.65, reflex: 300, jitter: 45, lag: 15 },
  { name: 'Wes', skill: 0.3, reflex: 230, jitter: 60, lag: 25 },
]

const gauss = () => {
  const u = Math.random() || 1e-9
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}

const log = (s = '') => console.log(s)
const pad = (s: string, n: number) => s.padEnd(n)

function attempt(bots: Bot[], armedAt: number, difficulty: number, barred: Set<string>): void {
  for (const bot of bots) {
    const conn = bot.conn
    if (!conn || barred.has(conn.playerId)) continue

    const confidence = bot.skill - difficulty + gauss() * 0.15
    if (confidence <= 0) continue

    const reaction = bot.reflex + (1 - Math.min(1, confidence)) * 380 + gauss() * bot.jitter
    const pressAt = armedAt + Math.max(30, reaction)

    setTimeout(
      () => conn.send({ t: 'buzz', at: pressAt }),
      Math.max(0, pressAt - conn.now()) + bot.lag,
    )
  }
}

async function main() {
  log(`\n  Party Buzzer — synthetic self-play against ${link(URL)}`)
  log(`  pace ×${PACE}${ROUNDS === Infinity ? '' : `, ${ROUNDS} rounds`}  ·  Ctrl-C to stop\n`)

  const host = await connect(URL, 'host')
  if (GAME) {
    host.send({ t: 'host', action: { a: 'setMode', id: GAME, options: {} } })
    await host.waitFor((s) => s.game.id === GAME)
    log(`  game mode: ${GAME}`)
  }
  const bots: Bot[] = []
  for (const spec of ROSTER) {
    const bot = { ...spec }
    bot.conn = await connect(URL, 'player', bot.name)
    bots.push(bot)
    await sleep(40)
  }
  log(`  ${bots.length} bots in the room: ${bots.map((b) => b.name).join(', ')}`)

  const cleanup = () => {
    for (const bot of bots) {
      if (bot.conn) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
    }
    host.send({ t: 'host', action: { a: 'next' } })
    log('\n  bots removed. \n')
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', cleanup)

  const byId = new Map(bots.map((b) => [b.conn!.playerId, b]))
  host.send({ t: 'host', action: { a: 'next' } })

  for (let q = 1; q <= ROUNDS; q++) {
    const difficulty = Math.random()
    const value = (Math.floor(Math.random() * 5) + 1) * 100
    host.send({ t: 'host', action: { a: 'setValue', value } })
    await beat(2500)

    log('')
    log(`  ── Q${q}  ${value} points  ·  ${difficulty < 0.35 ? 'gimme' : difficulty < 0.7 ? 'fair' : 'stumper'}`)

    const barred = new Set<string>()
    let resolved = false

    for (let pass = 0; pass < 3 && !resolved; pass++) {
      host.send({ t: 'host', action: { a: pass === 0 ? 'arm' : 'wrong', neg: value } })
      const armedState = await host.waitFor((s) => s.round.phase === 'ARMED')
      const armedAt = armedState.round.armedAt

      attempt(bots, armedAt, difficulty - pass * 0.25, barred)

      let locked: State
      try {
        locked = await host.waitFor((s) => s.round.phase === 'LOCKED', 4000)
      } catch {
        log('     nobody buzzed')
        break
      }

      const order = locked.round.order
      log(
        `     ${order
          .map((b, i) => `${pad(b.name, 6)}${i === 0 ? '  first' : `+${b.deltaMs}ms`}`)
          .join('  ·  ')}`,
      )

      await beat(3200)

      const leader = order[0]
      const bot = byId.get(leader.playerId)
      const right = !bot || Math.random() < 0.5 + bot.skill * 0.4

      if (right) {
        host.send({ t: 'host', action: { a: 'correct' } })
        log(`     ${leader.name} answers — correct, +${value}`)
        resolved = true
      } else {
        barred.add(leader.playerId)
        log(`     ${leader.name} answers — wrong, −${value}, locked out`)
      }
      await beat(1800)
    }


    const scores = host.state()?.scores ?? {}
    log(
      `     ${bots
        .map((b) => `${b.name} ${scores[b.conn!.playerId] ?? 0}`)
        .sort()
        .join('   ')}`,
    )
    await beat(1500)
    host.send({ t: 'host', action: { a: 'next' } })
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
