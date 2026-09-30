/**
 * Synthetic self-play for the tank minigame. Bots join, get paired into crews
 * by the server, and fight. Drivers work the dial like a person: point at a
 * heading, drive forward through the arc while the hull swings round, circle
 * the nearest enemy at mid range, back off when crowded, and steer around the
 * cover in front of them. Gunners select an absolute world heading and fire once
 * the slewing turret is actually lined up. Solo crews aim their fixed turret
 * with the hull.
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
import { link } from '../server/net.ts'
import type { TankCrew, TankInput } from '../shared/protocol.ts'
import { circleHitsCover } from '../server/minigames/tank/cover.ts'
import { TANK_FIELD, TANK_RADIUS } from '../server/minigames/tank/types.ts'

const [argMatches, argSeconds, argUrl] = process.argv.slice(2)
const MATCHES = Number(argMatches ?? Infinity)
const SECONDS = Number(argSeconds ?? 60)
const URL = await reachable(argUrl)
const NAMES = ['Ivy', 'Jax', 'Kai', 'Lux', 'Mo', 'Rex', 'Zed']
const TICK_MS = 50

type Bot = { name: string; conn: Conn; seq: number }

const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))
const log = (s = '') => console.log(s)
type Point = { x: number; y: number }

// Headings tried around the wanted one, nearest first, when cover is in the way.
const DETOURS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1]

/** Whether a tank can drive about a hull length along a heading without meeting cover or the field edge. */
function clearAhead(cover: Uint8Array | null, from: Point, heading: number, sign = 1): boolean {
  for (const distance of [30, 60, 90]) {
    const p = { x: from.x + Math.cos(heading) * distance * sign, y: from.y + Math.sin(heading) * distance * sign }
    const r = TANK_RADIUS + 4
    if (p.x < r || p.y < r || p.x > TANK_FIELD.width - r || p.y > TANK_FIELD.height - r) return false
    if (cover && circleHitsCover(cover, p, r)) return false
  }
  return true
}

/** The open heading nearest the wanted one, or null when every detour is blocked. */
const openHeading = (cover: Uint8Array | null, from: Point, wanted: number) =>
  DETOURS.map((offset) => wrap(wanted + offset)).find((heading) => clearAhead(cover, from, heading)) ?? null

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
  let cover: Uint8Array | null = null
  // Which way this crew circles its target; it changes its mind now and then.
  let orbit = Math.random() < 0.5 ? 1 : -1
  let orbitUntil = 0
  let dial: number | null = null
  let dialAt = 0

  while (board.now() < endsAt) {
    await sleep(TICK_MS)
    const frame = board.frame()
    if (frame?.role !== 'board' || frame.id !== 'tank' || frame.matchId !== matchId) continue
    // The full grid arrives about once a second; cover only shrinks, so a stale copy just steers wider.
    if (frame.cover) cover = Uint8Array.from(frame.cover, (digit) => digit === '1' ? 1 : 0)
    const me = frame.tanks.find((tank) => tank.id === crew.id)
    const enemies = frame.tanks.filter((tank) => tank.id !== crew.id && !tank.dead)
    if (!me || me.dead || enemies.length === 0) continue
    const distanceTo = (p: Point) => Math.hypot(p.x - me.position.x, p.y - me.position.y)
    const target = enemies.reduce((a, b) => distanceTo(a.position) < distanceTo(b.position) ? a : b)
    const distance = distanceTo(target.position)
    const bearing = Math.atan2(target.position.y - me.position.y, target.position.x - me.position.x)

    if (board.now() > orbitUntil) {
      if (orbitUntil > 0 && Math.random() < 0.5) orbit = -orbit
      orbitUntil = board.now() + 5_000 + Math.random() * 5_000
    }

    // Driver: close in from far away, circle at mid range, and reverse out when crowded,
    // still facing the enemy. Solo crews face the enemy so their fixed turret bears.
    const moved = Math.hypot(me.position.x - last.x, me.position.y - last.y)
    last = { ...me.position }
    stuckTicks = drive !== 0 && moved < 0.5 ? stuckTicks + 1 : 0
    if (stuckTicks > 8) {
      escapeTicks = 14
      orbit = -orbit
    }
    let wanted: number
    let nextDrive: -1 | 0 | 1
    if (escapeTicks > 0) {
      // Back straight out and swing the nose toward the new orbit side.
      escapeTicks--
      wanted = dial ?? me.hull
      if (escapeTicks === 13) wanted = wrap(me.hull + orbit * Math.PI / 2)
      nextDrive = clearAhead(cover, me.position, me.hull, -1) ? -1 : 1
    } else if (distance < 200) {
      wanted = bearing
      nextDrive = clearAhead(cover, me.position, me.hull, -1) ? -1 : 0
    } else {
      const aim = solo ? bearing
        : distance > 450 ? bearing + orbit * 0.3
        : bearing + orbit * (Math.PI / 2 - 0.35)
      wanted = openHeading(cover, me.position, aim) ?? wrap(aim + Math.PI)
      // Drive through gentle turns; stop and pivot only when the heading is well behind.
      const holding = solo && distance <= 450 && Math.abs(wrap(bearing - me.hull)) < 0.3
      nextDrive = holding || Math.abs(wrap(wanted - me.hull)) > 1.3 ? 0 : 1
    }

    // A hand on the dial: move it when the plan changes, with a little wobble.
    if (dial === null || Math.abs(wrap(wanted - dial)) > 0.15 || board.now() - dialAt > 600) {
      dial = wrap(wanted + (Math.random() - 0.5) * 0.08)
      dialAt = board.now()
      send(driver, { kind: 'hullAim', angle: dial })
    }
    if (nextDrive !== drive) {
      drive = nextDrive
      send(driver, { kind: 'drive', dir: drive })
    }

    // Gunner: point in world space with a little hand wobble. The server slews
    // the relative turret angle so this target stays fixed while the hull turns.
    if (!solo) send(gunner, { kind: 'turretAim', angle: wrap(bearing + (Math.random() - 0.5) * 0.1) })
    const aimError = wrap(bearing - me.hull - me.turret)
    const aligned = Math.abs(aimError) < 0.08
    if (aligned !== gunDown) {
      gunDown = aligned
      send(gunner, { kind: 'trigger', weapon: 'gun', down: gunDown, at: board.now() })
    }
    if (aligned && board.now() - lastCannon > 4_100) {
      lastCannon = board.now()
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: true, at: board.now() })
      send(gunner, { kind: 'trigger', weapon: 'cannon', down: false, at: board.now() })
    }
  }
}

async function main() {
  log(`\n  Party Buzzer — tank self-play against ${link(URL)}`)
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
    // Back to Ready: whatever the round held before the match does not come back up.
    host.send({ t: 'host', action: { a: 'next' } })
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
