import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import { link } from '../server/net.ts'
import { BOW_FIELD, BOW_STEP_MS, type Vec2 } from '../server/minigames/bow/types.ts'
import { createBowWorld } from '../server/minigames/bow/world.ts'

const [argMatches, argSeconds, argUrl] = process.argv.slice(2)
const MATCHES = Number(argMatches ?? Infinity)
const SECONDS = Number(argSeconds ?? 40)
const URL = await reachable(argUrl)

type Bot = {
  name: string
  wobble: number
  drawMs: number
  pauseMs: number
  conn?: Conn
  seq: number
}

const ROSTER: Omit<Bot, 'seq'>[] = [
  { name: 'Nia', wobble: 0.01, drawMs: 450, pauseMs: 250 },
  { name: 'Owen', wobble: 0.03, drawMs: 500, pauseMs: 300 },
  { name: 'Priya', wobble: 0.02, drawMs: 800, pauseMs: 600 },
  { name: 'Sam', wobble: 0.07, drawMs: 250, pauseMs: 60 },
  { name: 'Tess', wobble: 0.03, drawMs: 600, pauseMs: 400 },
  { name: 'Wes', wobble: 0.09, drawMs: 700, pauseMs: 900 },
]

const gauss = () => {
  const u = Math.random() || 1e-9
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const log = (s = '') => console.log(s)

const physics = createBowWorld({ seed: 0, playerIds: [], targets: [] }).config

function miss(origin: Vec2, angle: number, tension: number, center: Vec2): number {
  const fromUp = angle * 65 * Math.PI / 180
  const speed = physics.minSpeed + (physics.maxSpeed - physics.minSpeed) * tension
  const v = { x: Math.sin(fromUp) * speed, y: -Math.cos(fromUp) * speed }
  const p = { x: origin.x, y: origin.y - 20 }
  const dt = BOW_STEP_MS / 1000
  let best = Infinity
  for (let t = 0; t < physics.flyingLifetimeMs; t += BOW_STEP_MS) {
    v.y += physics.gravity * dt
    p.x += v.x * dt
    p.y += v.y * dt
    best = Math.min(best, Math.hypot(p.x - center.x, p.y - center.y))
    if (p.x < 0 || p.x > BOW_FIELD.width || p.y < 0 || p.y > BOW_FIELD.height) break
  }
  return best
}

function solve(origin: Vec2, center: Vec2) {
  let best = { angle: 0, tension: 1, miss: Infinity }
  for (let angle = -1; angle <= 1; angle += 0.02) {
    for (let tension = 0.3; tension <= 1; tension += 0.05) {
      const m = miss(origin, angle, tension, center)
      if (m < best.miss) best = { angle, tension, miss: m }
    }
  }
  return best
}

async function play(bot: Bot, matchId: string, startsAt: number, endsAt: number, reloadMs: number, shots: ReturnType<typeof solve>[]) {
  const conn = bot.conn!
  const send = (input: { kind: 'aim'; angle: number; tension: number } | { kind: 'release'; at: number }) =>
    conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input })
  await sleep(Math.max(0, startsAt - conn.now()) + Math.random() * 400)
  while (conn.now() + bot.drawMs < endsAt) {
    const shot = shots[Math.floor(Math.random() * shots.length)]
    const angle = clamp(shot.angle + gauss() * bot.wobble, -1, 1)
    const tension = clamp(shot.tension + gauss() * bot.wobble, 0, 1)
    const steps = Math.max(1, Math.round(bot.drawMs / 33))
    for (let i = 1; i <= steps; i++) {
      send({ kind: 'aim', angle, tension: tension * i / steps })
      await sleep(bot.drawMs / steps)
    }
    send({ kind: 'release', at: conn.now() })
    await sleep(reloadMs + bot.pauseMs * (0.5 + Math.random()))
  }
}

async function main() {
  log(`\n  Party Buzzer — bow self-play against ${link(URL)}`)
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
    host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'bow', options: { durationSec: SECONDS } } })
    await host.waitFor((s) => s.minigame?.phase === 'ready' && s.minigame.matchId !== previous)
    host.send({ t: 'host', action: { a: 'startMinigame' } })
    const session = (await host.waitFor((s) => s.minigame?.phase === 'countdown')).minigame!

    const world = createBowWorld({ seed: session.options.seed, playerIds: session.participants })
    log('')
    log(`  ── Match ${m}  ·  ${session.participants.length} players  ·  seed ${session.options.seed}`)

    const playing = bots
      .filter((bot) => session.participants.includes(bot.conn!.playerId))
      .map((bot) => {
        const origin = world.players[bot.conn!.playerId].origin
        const shots = world.targets.map((target) => solve(origin, target.center))
        return play(bot, session.matchId, session.startsAt!, session.endsAt!, session.options.reloadMs, shots)
      })
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
      log(`     ${names(result.playerId).padEnd(6)} ${String(result.points).padStart(4)} pts  ${result.shots} shots`)
    }
    await sleep(4000)
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
