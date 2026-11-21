import { LETTERS } from '../shared/choice.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, reachable, type Conn } from './conn.ts'
import { link } from '../server/net.ts'
import { clipPath, run } from '../server/speech.ts'
import { ARM_DELAY_MS, COLLECT_MS, type MinigameId, type QuizReactKind } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const URL = await reachable(process.env.URL)

const log = (s = '') => console.log(s)

const SPEAKER = process.env.SAY_VOICE ?? 'Samantha'
async function sayClip(text: string): Promise<string> {
  const dir = join(import.meta.dirname, '..', 'packs', '.cache')
  mkdirSync(dir, { recursive: true })
  const path = clipPath(dir, text, `answer:${SPEAKER}`).replace(/\.aiff$/, '.wav')
  if (existsSync(path)) return path
  const tmp = `${path}.tmp.wav`
  const fmt = '--data-format=LEI16@22050'
  const ok =
    (await run('say', ['-v', SPEAKER, fmt, '-o', tmp, text])).ok ||
    (await run('say', [fmt, '-o', tmp, text])).ok
  if (!ok) {
    rmSync(tmp, { force: true })
    throw new Error(`say could not render "${text}" — no simulated speech on this box`)
  }
  renameSync(tmp, path)
  return path
}

async function main() {
  if (args.length === 0) {
    log('\n  usage: npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@120 correct')
    log('  steps: loop join value arm buzz correct wrong next reset undo pack mode direct autoplay rewind read armed act speak say pick guess done teams setlist jump duel minigame ready in out vote unvote seat cancel react wait clear')
    log('  walks: npm run walk-duel   walk-teams   walk-setlist   walk-read-quizbowl   walk-read-trivia   walk-packs\n')
    return
  }

  const looping = args.includes('loop')
  const steps = args.filter((s) => s !== 'loop')

  const host = await connect(URL, 'host')
  const players = new Map<string, Conn>()

  const idFor = (name: string) =>
    host.state()?.players.find((p) => p.name === name)?.id ??
    `probe-${name.toLowerCase().replace(/\W+/g, '-')}`

  const player = (name: string) => {
    const conn = players.get(name)
    if (!conn) throw new Error(`${name} has not joined — add them to a join: step`)
    return conn
  }

  const assigned = new Set<string>()
  const madeTeams = new Set<string>()
  let teamsAreOurs = false
  let setlistIsOurs = false
  let readIsOurs = false
  let autoplayIsOurs = false
  let minigameIsOurs = false

  const clear = () => {
    if (readIsOurs) host.send({ t: 'act', act: 'stopRead' })
    if (minigameIsOurs) {
      host.send({ t: 'host', action: { a: 'cancelMinigame' } })
      host.send({ t: 'host', action: { a: 'closeMinigame' } })
    }
    if (autoplayIsOurs) {
      host.send({ t: 'host', action: { a: 'setAutoplay', on: false, nextSec: 5, buzzSec: 10, reboundSec: 2, introSec: 12 } })
    }
    host.send({ t: 'host', action: { a: 'next' } })
    if (setlistIsOurs) host.send({ t: 'host', action: { a: 'clearSetlist' } })
    host.send({ t: 'host', action: { a: 'cancelDuel' } })
    for (const playerId of assigned) host.send({ t: 'host', action: { a: 'assign', playerId } })
    if (teamsAreOurs) host.send({ t: 'host', action: { a: 'setGrouping', grouping: 'solo' } })
    const gone = (host.state()?.players ?? []).filter((p) => p.id.startsWith('probe-'))
    for (const p of gone) host.send({ t: 'host', action: { a: 'kick', playerId: p.id } })
    for (const key of madeTeams) host.send({ t: 'host', action: { a: 'setScore', key, score: 0 } })
    host.send({ t: 'host', action: { a: 'clearNight' } })
    log(`  cleared ${gone.length}`)
  }
  let stopping = false
  process.on('SIGINT', () => {
    if (stopping) process.exit(1)
    stopping = true
    log('')
    clear()
    setTimeout(() => process.exit(0), 300)
  })

  log(`\n  Party Buzzer — probe against ${link(URL)}`)
  log(looping ? '  looping — Ctrl-C to stop and remove the players\n' : '')

  for (let pass = 1; ; pass++) {
    if (looping) log(`  ── pass ${pass}`)
    for (const step of steps) {
      const sep = step.indexOf(':')
      const verb = sep === -1 ? step : step.slice(0, sep)
      const arg = sep === -1 ? '' : step.slice(sep + 1)
      log(`  ${step}`)

      switch (verb) {
        case 'join':
          for (const name of arg.split(',').filter(Boolean)) {
            if (players.has(name)) continue
            players.set(name, await connect(URL, 'player', name, idFor(name)))
            await sleep(40)
          }
          break

        case 'value':
          host.send({ t: 'host', action: { a: 'setValue', value: Number(arg) } })
          break

        case 'arm': {
          host.send({ t: 'host', action: { a: 'arm' } })
          await host.waitFor((s) => s.round.phase === 'ARMED')
          break
        }

        case 'pick': {
          await host.waitFor((s) => !!s.round.choices, 60_000)
          const up = Date.now()
          for (const spec of arg.split(',').filter(Boolean)) {
            const [who, offset = '0'] = spec.split('@')
            const [name, letter = ''] = who.split('=')
            const index = LETTERS.indexOf(letter.toUpperCase())
            if (!name || letter.length !== 1 || index < 0) throw new Error(`pick needs Name=Letter, got "${spec}"`)
            const conn = player(name)
            void sleep(Math.max(0, up + Number(offset) - Date.now())).then(() =>
              conn.send({ t: 'act', act: 'pick', data: index }),
            )
          }
          await host.waitFor((s) => s.round.correct !== undefined, 180_000)
          break
        }

        case 'guess': {
          await host.waitFor((s) => !!s.round.guessing, 60_000)
          const up = Date.now()
          for (const spec of arg.split(',').filter(Boolean)) {
            const [who, offset = '0'] = spec.split('@')
            const [name, number = ''] = who.split('=')
            const n = Number(number)
            if (!name || number === '' || !Number.isFinite(n)) throw new Error(`guess needs Name=Number, got "${spec}"`)
            const conn = player(name)
            void sleep(Math.max(0, up + Number(offset) - Date.now())).then(() =>
              conn.send({ t: 'act', act: 'guess', data: n }),
            )
          }
          await host.waitFor((s) => s.round.truth !== undefined, 180_000)
          break
        }

        case 'buzz': {
          const armedAt = host.state()?.round.armedAt ?? 0
          if (!armedAt) throw new Error('buzz before arm — nothing is open')
          let last = 0
          for (const spec of arg.split(',').filter(Boolean)) {
            const [name, offset = '0'] = spec.split('@')
            const conn = player(name)
            const pressAt = armedAt + Number(offset)
            last = Math.max(last, Number(offset))
            void sleep(Math.max(0, pressAt - conn.now())).then(() =>
              conn.send({ t: 'buzz', at: pressAt }),
            )
          }
          const settle = last + COLLECT_MS + ARM_DELAY_MS
          await Promise.race([
            host.waitFor((s) => s.round.phase === 'LOCKED', settle + 500).catch(() => {}),
            sleep(settle),
          ])
          break
        }

        case 'correct':
          host.send({ t: 'host', action: { a: 'correct' } })
          break
        case 'wrong':
          host.send({ t: 'host', action: { a: 'wrong', neg: Number(arg || 0) } })
          break
        case 'next':
          host.send({ t: 'host', action: { a: 'next' } })
          break
        case 'reset':
          host.send({ t: 'host', action: { a: 'resetRound' } })
          break
        case 'undo':
          host.send({ t: 'host', action: { a: 'undo' } })
          break

        case 'pack': {
          host.send({ t: 'act', act: 'selectPack', data: arg })
          await host.waitFor((s) => s.reading?.pack === arg && !s.reading.rendering, 180_000)
          readIsOurs = true
          log(`  pack ${arg} (${host.state()?.reading?.qTotal} questions)`)
          break
        }

        case 'autoplay': {
          const [on, next = '4', rebound = '2', intro = '12'] = arg.split(':')
          host.send({
            t: 'host',
            action: {
              a: 'setAutoplay',
              on: on !== 'off',
              nextSec: Number(next),
              buzzSec: 10,
              reboundSec: Number(rebound),
              introSec: Number(intro),
            },
          })
          autoplayIsOurs = true
          break
        }

        case 'mode':
          host.send({ t: 'host', action: { a: 'setMode', id: arg, options: {} } })
          await host.waitFor((s) => s.game.id === arg, 3000)
          break

        case 'mirror':
          host.send({ t: 'host', action: { a: 'setMirror', on: arg === 'on' } })
          await host.waitFor((s) => s.mirrorFragments === (arg === 'on'), 3000)
          break

        case 'direct':
          host.send({ t: 'host', action: { a: 'clearSetlist' } })
          await host.waitFor((s) => !s.setlist, 3000).catch(() => {})
          break

        case 'rewind':
          host.send({ t: 'act', act: 'rewindRead' })
          break

        case 'read':
          host.send({ t: 'act', act: 'read' })
          readIsOurs = true
          await host.waitFor((s) => !!s.readingActive, 3000).catch(() => {
            throw new Error(
              'read did nothing — no pack is selected, or the setlist block the ' +
                'room is on names none. `direct` first, or give the block a pack.',
            )
          })
          break

        case 'armed':
          await host.waitFor((s) => s.round.phase === 'ARMED', 300_000)
          break

        case 'done':
          await host.waitFor((s) => !s.readingActive, 120_000)
          break

        case 'act': {
          const [name, ...rest] = arg.split(':')
          host.send({ t: 'act', act: name, data: rest.join(':') || undefined })
          break
        }

        case 'speak':
        case 'say': {
          const [name, ...rest] = arg.split('=')
          const text = rest.join('=')
          if (!name || !text) throw new Error(`${verb} needs Name=words`)
          const conn = player(name)
          const clip = verb === 'say' ? await sayClip(text) : ''
          await host
            .waitFor(
              (s) =>
                s.round.phase === 'LOCKED' &&
                !!s.round.judge &&
                s.round.order[0]?.playerId === conn.playerId,
              10_000,
            )
            .catch(() => {
              throw new Error(`no answer window for ${name} — is the judge on? (see [stt] at boot)`)
            })
          const res = await fetch(`${URL}/spoken?player=${conn.playerId}`, {
            method: 'POST',
            headers: { 'content-type': clip ? 'audio/wav' : 'text/plain' },
            body: clip ? await readFile(clip) : text,
          })
          log(`  → ${res.status} ${JSON.stringify(await res.json().catch(() => ({})))}`)
          break
        }

        case 'teams': {
          if (host.state()?.grouping !== 'teams') {
            host.send({ t: 'host', action: { a: 'setGrouping', grouping: 'teams' } })
            await host.waitFor((s) => s.grouping === 'teams')
            teamsAreOurs = true
          }
          for (const group of arg.split('/').filter(Boolean)) {
            const [teamName, members = ''] = group.split('=')
            if (!host.state()?.teams.some((t) => t.name === teamName)) {
              const n = ((host.state()?.teams.length ?? 0) % 6) + 1
              host.send({
                t: 'host',
                action: { a: 'addTeam', name: teamName, color: `var(--id-${n})` },
              })
              await host.waitFor((s) => s.teams.some((t) => t.name === teamName))
              madeTeams.add(host.state()!.teams.find((t) => t.name === teamName)!.id)
            }
            const teamId = host.state()!.teams.find((t) => t.name === teamName)!.id
            for (const name of members.split(',').filter(Boolean)) {
              const playerId = idFor(name)
              assigned.add(playerId)
              host.send({ t: 'host', action: { a: 'assign', playerId, teamId } })
            }
          }
          break
        }

        case 'setlist': {
          const blocks = arg.split(',').filter(Boolean).map((part) => {
            const [head, duel] = part.split(':')
            const [spec, pack] = head.split('@')
            const [game, count = '1'] = spec.split('*')
            return {
              game,
              options: {},
              count: Number(count),
              ...(pack ? { pack } : {}),
              ...(duel ? { duel } : {}),
            }
          })
          host.send({ t: 'host', action: { a: 'setSetlist', blocks } })
          const loaded = await host.waitFor((s) => s.setlist?.blocks.length === blocks.length)
          if (loaded.arrival?.kind === 'introduction') {
            host.send({ t: 'host', action: { a: 'closeArrival', arrivalId: loaded.arrival.id } })
            await host.waitFor((s) => !s.arrival)
          }
          setlistIsOurs = true
          log(`  setlist ${blocks.length} blocks`)
          break
        }

        case 'jump':
          host.send({ t: 'host', action: { a: 'setlistJump', at: Number(arg) } })
          break

        case 'minigame': {
          const [what, ...rest] = arg.split(':')
          if (what === 'prepare') {
            const s = host.state()
            const named = rest.find((x) => x && Number.isNaN(Number(x)))
            const id = named ?? s?.setlist?.blocks[s.setlist.at]?.game
            if (!id) throw new Error('minigame:prepare needs a setlist block or a name')
            const secs = rest.find((x) => x && !Number.isNaN(Number(x)))
            const options = secs ? { durationSec: Number(secs) } : {}
            host.send({ t: 'host', action: { a: 'prepareMinigame', id: id as MinigameId, options } })
            await host.waitFor((s) => s.minigame?.id === id && s.minigame.phase === 'ready', 3000)
            minigameIsOurs = true
          } else if (what === 'start') {
            host.send({ t: 'host', action: { a: 'startMinigame' } })
          } else if (what === 'close') {
            host.send({ t: 'host', action: { a: 'closeMinigame' } })
            await host.waitFor((s) => !s.minigame, 3000)
            minigameIsOurs = false
          } else throw new Error(`unknown minigame step "${what}"`)
          break
        }

        case 'ready':
          for (const conn of players.values()) conn.send({ t: 'minigameLobby', change: { do: 'ready', on: true } })
          break

        case 'duel':
          host.send({ t: 'host', action: { a: 'openDuel', rule: arg } })
          break

        case 'in':
        case 'out':
          for (const name of arg.split(',').filter(Boolean))
            player(name).send({
              t: 'act',
              act: verb === 'in' ? 'duelVolunteer' : 'duelBackOff',
            })
          break

        case 'react':
          for (const pair of arg.split(',').filter(Boolean)) {
            const [name, kind] = pair.split('=')
            player(name).send({ t: 'react', kind: kind as QuizReactKind })
          }
          break

        case 'vote':
          for (const pair of arg.split(',').filter(Boolean)) {
            const [voter, target] = pair.split('=')
            if (!target) throw new Error(`vote needs voter=target, got "${pair}"`)
            player(voter).send({ t: 'act', act: 'duelVote', data: idFor(target) })
            await sleep(250)
          }
          break

        case 'unvote':
          for (const name of arg.split(',').filter(Boolean)) {
            const held = host
              .state()
              ?.duel?.pool.find((e) => e.votes.includes(idFor(name)))
            if (!held) throw new Error(`${name} has no vote to take back`)
            player(name).send({ t: 'act', act: 'duelVote', data: held.playerId })
            await sleep(250)
          }
          break

        case 'seat': {
          const ids = arg.split(',').filter(Boolean).map(idFor)
          host.send({
            t: 'host',
            action:
              ids.length === 2
                ? { a: 'closeDuel', playerIds: [ids[0], ids[1]] }
                : { a: 'closeDuel' },
          })
          break
        }

        case 'cancel':
          host.send({ t: 'host', action: { a: 'cancelDuel' } })
          break

        case 'wait':
          await sleep(Number(arg))
          break
        case 'clear':
          clear()
          await sleep(150)
          break

        default:
          throw new Error(`unknown step "${step}"`)
      }

      await sleep(120)
    }

    if (!looping) break
  }

  log('')
  process.exit(0)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
