/**
 * Synthetic self-play for the tank minigame. Bots join, get paired into crews
 * by the server, and fight: drivers steer toward the nearest enemy, gunners
 * crank the turret onto it and fire when lined up. Hull turns swing the gun,
 * so gunners keep correcting, which is the coordination the game is about.
 *
 * Bots read the shared field through a board connection, like the TV does.
 *
 *   npm run sim-tank                        endless 60-second matches
 *   npm run sim-tank -- 3 30                three 30-second matches
 *   npm run sim-tank -- 3 30 http://box:8080
 *
 * Ctrl-C cancels the match and removes the bots.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import type { TankCrew, TankInput } from '../shared/protocol.ts'

const [argMatches, argSeconds, argUrl] = process.argv.slice(2)
const MATCHES = Number(argMatches ?? Infinity)
const SECONDS = Number(argSeconds ?? 60)
const URL = argUrl ?? (await reachable())
const NAMES = ['Ivy', 'Jax', 'Kai', 'Lux', 'Mo', 'Rex', 'Zed']
const TICK_MS = 50

type Bot = { name: string; conn: Conn; seq: number }

const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const log = (s = '') => console.log(s)

async function crewLoop(crew: TankCrew, bots: Map<string, Bot>, board: Conn, matchId: string, endsAt: number) {
  const driver = bots.get(crew.driver)
  const gunner = bots.get(crew.gunner)
  if (!driver || !gunner) return
  const solo = driver === gunner
  const send = (bot: Bot, input: TankInput) => bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input })
  let drive: -1 | 0 | 1 = 0
  let gunDown = false
  let lastCannon = 0
  let last = { x: 0, y: 0 }
  let stuckTicks = 0
  let escapeTicks = 0

  while (board.now() < endsAt) {
    await sleep(TICK_MS)
    const frame = board.frame()
    if (frame?.role !== 'board' || frame.id !== 'tank' || frame.matchId !== matchId) continue
    const me = frame.tanks.find((tank) => tank.id === crew.id)
    const enemies = frame.tanks.filter((tank) => tank.id !== crew.id && !tank.dead)
    if (!me || me.dead || enemies.length === 0) continue
    const distanceTo = (p: { x: number; y: number }) => Math.hypot(p.x - me.position.x, p.y - me.position.y)
    const target = enemies.reduce((a, b) => distanceTo(a.position) < distanceTo(b.position) ? a : b)
    const distance = distanceTo(target.position)
    const bearing = Math.atan2(target.position.y - me.position.y, target.position.x - me.position.x)

    // Driver: steer at the target, hold a middle distance, and back out when wedged on cover.
    const moved = Math.hypot(me.position.x - last.x, me.position.y - last.y)
    last = { ...me.position }
    stuckTicks = drive !== 0 && moved < 0.5 ? stuckTicks + 1 : 0
    if (stuckTicks > 10) escapeTicks = 15
    const hullError = wrap(bearing - me.hull)
    let nextDrive: -1 | 0 | 1 = Math.abs(hullError) > 1 ? 0 : distance > 380 ? 1 : distance < 220 ? -1 : 0
    let hullRate = clamp(hullError / (Math.PI / 2), -1, 1)
    if (escapeTicks > 0) {
      escapeTicks--
      nextDrive = -1
      hullRate = 0.8
    }
    send(driver, solo ? { kind: 'turn', rate: hullRate, part: 'hull' } : { kind: 'turn', rate: hullRate })
    if (nextDrive !== drive) {
      drive = nextDrive
      send(driver, { kind: 'drive', dir: drive })
    }

    // Gunner: correct for the hull, with a little hand wobble.
    const aimError = wrap(bearing - me.hull - me.turret) + (Math.random() - 0.5) * 0.1
    const turretRate = clamp(aimError / (Math.PI / 2), -4 / 3, 4 / 3)
    if (!solo) send(gunner, { kind: 'turn', rate: turretRate })
    const aligned = Math.abs(aimError) < 0.08
    if (aligned !== gunDown) {
      gunDown = aligned
      send(gunner, { kind: 'trigger', weapon: 'gun', down: gunDown, at: board.now() })
    }
    if (aligned && board.now() - lastCannon > 3_100) {
      lastCannon = board.now()
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: true, at: board.now() })
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: false, at: board.now() })
    }
  }
}

async function main() {
  log(`\n  Party Buzzer — tank self-play against ${URL}`)
  log(`  ${SECONDS}-second matches${MATCHES === Infinity ? '' : `, ${MATCHES} of them`}  ·  Ctrl-C to stop\n`)

  const host = await connect(URL, 'host')
  const board = await connect(URL, 'board')
  const bots = new Map<string, Bot>()
  for (const name of NAMES) {
    // Sequence numbers start from the clock so a rerun never reuses remembered ones.
    const bot: Bot = { name, conn: await connect(URL, 'player', name), seq: Date.now() }
    bots.set(bot.conn.playerId, bot)
    await sleep(40)
  }
  log(`  ${bots.size} bots in the room: ${NAMES.join(', ')}`)

  const cleanup = () => {
    host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    host.send({ t: 'host', action: { a: 'closeMinigame' } })
    for (const bot of bots.values()) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
    board.close()
    log('\n  match closed, bots removed.\n')
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', cleanup)

  if (host.state()?.round.phase !== 'IDLE') {
    host.send({ t: 'host', action: { a: 'next' } })
    await host.waitFor((s) => s.round.phase === 'IDLE')
  }
  const nameOf = (id: string) => host.state()?.players.find((p) => p.id === id)?.name ?? '?'

  for (let m = 1; m <= MATCHES; m++) {
    const previous = host.state()?.minigame?.matchId
    if (host.state()?.minigame?.phase === 'playing' || host.state()?.minigame?.phase === 'countdown') {
      host.send({ t: 'host', action: { a: 'cancelMinigame' } })
    }
    host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'tank', options: { durationSec: SECONDS } } })
    await host.waitFor((s) => s.minigame?.phase === 'ready' && s.minigame.matchId !== previous)
    host.send({ t: 'host', action: { a: 'startMinigame' } })
    const session = (await host.waitFor((s) => s.minigame?.phase === 'countdown')).minigame!
    const crews = session.crews ?? []

    log('')
    log(`  ── Match ${m}  ·  ${crews.length} crews`)
    for (const crew of crews) {
      log(`     ${crew.driver === crew.gunner ? `${nameOf(crew.driver)} (solo)` : `${nameOf(crew.driver)} drives, ${nameOf(crew.gunner)} guns`}`)
    }

    await sleep(Math.max(0, session.startsAt! - host.now()))
    await Promise.all(crews.map((crew) => crewLoop(crew, bots, board, session.matchId, session.endsAt!)))

    const done = await host.waitFor(
      (s) => s.minigame?.phase === 'results' || s.minigame?.matchId !== session.matchId,
      SECONDS * 1000 + 10_000,
    )
    if (done.minigame?.phase !== 'results') {
      log('     match was cancelled')
      break
    }
    for (const result of done.minigame.results ?? []) {
      log(`     ${nameOf(result.playerId).padEnd(6)} ${String(result.points).padStart(4)} pts  ${result.shots} shots`)
    }
    await sleep(4000)
  }

  cleanup()
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
