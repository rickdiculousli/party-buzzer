/**
 * Synthetic self-play. Fills the room with bots that buzz like people so you can
 * watch the board and a phone across a real game — especially the timeline,
 * which only tells you anything once you have seen a photo finish and a
 * runaway question back to back.
 *
 * It is an ordinary client: real sockets, real protocol, real clock sync. The
 * server has no idea these aren't people, so what you see on the board is what
 * a real room would produce.
 *
 *   npm run sim                          against http://localhost:8080
 *   npm run sim -- 5                     stop after five questions
 *   npm run sim -- 5 2                   five questions, half speed, for watching
 *   npm run sim -- 5 1 http://box:8080   against another host
 *
 * The env vars (ROUNDS, PACE, URL) still work; positional args win.
 * Ctrl-C removes the bots on the way out, so your real game is left clean.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, type Conn } from './conn.ts'
import type { State } from '../shared/protocol.ts'

const [argRounds, argPace, argUrl] = process.argv.slice(2)
const ROUNDS = Number(argRounds ?? process.env.ROUNDS ?? Infinity)
const PACE = Number(argPace ?? process.env.PACE ?? 1)
const URL = argUrl ?? process.env.URL ?? 'http://localhost:8080'

/** Everything the eye needs time for is scaled by PACE; the buzzing is not. */
const beat = (ms: number) => sleep(ms * PACE)

// --- the room ---------------------------------------------------------------

type Bot = {
  name: string
  /** How much they tend to know. Compared against the question's difficulty. */
  skill: number
  /** Their floor: the fastest they ever get a thumb down, in ms. */
  reflex: number
  /** How consistent they are. Big numbers make a streaky player. */
  jitter: number
  /** Their phone's network lag, one way. The clamp should make this invisible. */
  lag: number
  conn?: Conn
}

/**
 * Deliberately uneven. A room where everyone is equally fast produces a
 * timeline that always looks the same, which tells you nothing about whether
 * the design works.
 */
const ROSTER: Bot[] = [
  { name: 'Nia', skill: 0.85, reflex: 190, jitter: 35, lag: 8 },
  { name: 'Owen', skill: 0.55, reflex: 210, jitter: 40, lag: 12 },
  { name: 'Priya', skill: 0.75, reflex: 250, jitter: 30, lag: 60 }, // knows a lot, bad wifi
  { name: 'Sam', skill: 0.45, reflex: 175, jitter: 90, lag: 10 }, // fast thumb, streaky
  { name: 'Tess', skill: 0.65, reflex: 300, jitter: 45, lag: 15 },
  { name: 'Wes', skill: 0.3, reflex: 230, jitter: 60, lag: 25 }, // here for the snacks
]

// --- plumbing ---------------------------------------------------------------

const gauss = () => {
  const u = Math.random() || 1e-9
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}

// --- the game ---------------------------------------------------------------

const log = (s = '') => console.log(s)
const pad = (s: string, n: number) => s.padEnd(n)

/**
 * One pass at an open buzzer. Every bot who isn't barred decides whether they
 * know it and how fast their thumb is, then presses at that moment. The press
 * time is what goes on the wire — the lag is applied to the send, exactly like
 * a real phone, so the clamp has something real to correct for.
 */
function attempt(bots: Bot[], armedAt: number, difficulty: number, barred: Set<string>): void {
  for (const bot of bots) {
    const conn = bot.conn
    if (!conn || barred.has(conn.playerId)) continue

    // Confidence is what's left of what they know after the question takes its
    // cut. Below zero they simply don't buzz, which is what makes a hard
    // question show up on the board as two marks instead of six.
    const confidence = bot.skill - difficulty + gauss() * 0.15
    if (confidence <= 0) continue

    // Sure of the answer means a thumb already moving; unsure means a beat of
    // hesitation. The spread runs well past the first 150ms on purpose: the
    // hesitant ones are the trickle the timeline shows filling in after the
    // provisional leader appears.
    const reaction = bot.reflex + (1 - Math.min(1, confidence)) * 380 + gauss() * bot.jitter
    const pressAt = armedAt + Math.max(30, reaction)

    setTimeout(
      () => conn.send({ t: 'buzz', at: pressAt }),
      Math.max(0, pressAt - conn.now()) + bot.lag,
    )
  }
}

async function main() {
  log(`\n  Party Buzzer — synthetic self-play against ${URL}`)
  log(`  pace ×${PACE}${ROUNDS === Infinity ? '' : `, ${ROUNDS} rounds`}  ·  Ctrl-C to stop\n`)

  const host = await connect(URL, 'host')
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
    // A spread of question difficulties, because the board only proves itself
    // across the range: a gimme is a photo finish, a stumper is two marks.
    const difficulty = Math.random()
    const value = (Math.floor(Math.random() * 5) + 1) * 100
    host.send({ t: 'host', action: { a: 'setValue', value } })
    await beat(600)

    log('')
    log(`  ── Q${q}  ${value} points  ·  ${difficulty < 0.35 ? 'gimme' : difficulty < 0.7 ? 'fair' : 'stumper'}`)

    const barred = new Set<string>()
    let resolved = false

    // Up to three passes: the first answer, then a rebound for each wrong one.
    for (let pass = 0; pass < 3 && !resolved; pass++) {
      host.send({ t: 'host', action: { a: pass === 0 ? 'arm' : 'wrong', neg: value } })
      const armedState = await host.waitFor((s) => s.round.phase === 'ARMED')
      const armedAt = armedState.round.armedAt

      // A rebound is a room already leaning in, so the field tightens up.
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

      // Hold here — this is the moment the timeline is on the wall and the
      // whole reason the simulation exists.
      await beat(3200)

      const leader = order[0]
      const bot = byId.get(leader.playerId)
      // Being first doesn't mean being right. A confident bot usually has it;
      // a human who joined in gets the benefit of the doubt.
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

    if (!resolved) {
      host.send({ t: 'host', action: { a: 'next' } })
      await beat(1200)
    }

    const scores = host.state()?.scores ?? {}
    log(
      `     ${bots
        .map((b) => `${b.name} ${scores[b.conn!.playerId] ?? 0}`)
        .sort()
        .join('   ')}`,
    )
    await beat(1500)
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
