/**
 * A scripted round, for when you need one exact moment to happen on demand.
 *
 * `sim.ts` plays a believable game, which is the right instrument for watching
 * the board over time and the wrong one for inspecting a single frame: you wait
 * on dice for the photo finish you wanted. Probe is the other half — you say
 * precisely who buzzed, how far behind, and what the host did next, and it
 * happens on the spot, the same way every time.
 *
 *   npm run probe -- join:Ada,Bo arm buzz:Ada@40,Bo@45          a photo finish
 *   npm run probe -- arm                                        open the buzzers
 *   npm run probe -- clear                                      put the room back
 *   npm run anim                                                every anchor, on repeat
 *
 * Steps run in order, left to right, and then the process exits — leaving the
 * board on whatever frame the last step produced. Nothing is being held up from
 * here: the screen is server state, so a one-shot command is enough to park the
 * room on an exact moment and walk away from it.
 *
 * Probe's players carry ids like `probe-ada`, so running the same command
 * repeatedly resumes the same people instead of stacking up duplicates, and
 * `clear` can find them again later. Anyone who joined from a real phone is left
 * alone, and `buzz` only ever drives the script's own players.
 *
 * Steps:
 *   join:A,B,C       connect players under those names
 *   value:400        set what the question is worth
 *   arm              open the buzzers (waits for ARMED before moving on)
 *   buzz:A@0,B@120   press, at that many ms after the buzzers open
 *   correct          award the leader
 *   wrong[:200]      dock the leader and lock them out, re-arming for a rebound
 *   next             clear the round
 *   reset | undo     reset the round / undo the last host action
 *   wait:1200        hold, in ms — the only step that exists for your eyes
 *   clear            kick probe's players and reset the round
 *   loop             repeat the whole script until Ctrl-C
 *
 * A note on pacing a `loop` script: to sit on the open buzzer before anyone
 * presses, push every offset out by that much (`buzz:Ada@1000,Bo@1250`) rather
 * than adding a `wait` after `arm`. The deltas the board draws are relative to
 * first place, so the timeline is identical either way — but a `wait` would let
 * all four packets arrive in the same tick, and the marks would appear at once
 * instead of landing one after another.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, type Conn } from './conn.ts'
import { ARM_LEAD_MS, COLLECT_MS } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const URL = process.env.URL ?? 'http://localhost:8080'

const log = (s = '') => console.log(s)

async function main() {
  if (args.length === 0) {
    // The header comment is the manual; printing a second copy is a second
    // thing to keep true.
    log('\n  usage: npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@120 correct')
    log('  steps: loop join value arm buzz correct wrong next reset undo wait clear\n')
    return
  }

  // `loop` anywhere in the script means the whole script repeats until Ctrl-C.
  // An animation you have to re-trigger by hand is one you end up judging from
  // memory; looping lets you sit and watch the same moment land twenty times.
  const looping = args.includes('loop')
  const steps = args.filter((s) => s !== 'loop')

  const host = await connect(URL, 'host')
  const players = new Map<string, Conn>()

  /**
   * Who `join:Name` should actually connect as.
   *
   * Someone of that name already in the room — one of `fakes`, or a phone —
   * gets borrowed rather than duplicated, because a board showing two Adas
   * teaches you nothing about either. Otherwise probe mints its own under a
   * stable `probe-` id, so running the same command twenty times resumes the
   * same four players instead of stacking up eighty, and `clear` can find them
   * again afterwards. Only the ones probe minted are ever kicked.
   */
  const idFor = (name: string) =>
    host.state()?.players.find((p) => p.name === name)?.id ??
    `probe-${name.toLowerCase().replace(/\W+/g, '-')}`

  const clear = () => {
    const gone = (host.state()?.players ?? []).filter((p) => p.id.startsWith('probe-'))
    for (const p of gone) host.send({ t: 'host', action: { a: 'kick', playerId: p.id } })
    host.send({ t: 'host', action: { a: 'next' } })
    log(`  cleared ${gone.length}`)
  }
  process.on('SIGINT', () => setTimeout(() => process.exit(0), 100))

  log(`\n  Party Buzzer — probe against ${URL}`)
  log(looping ? '  looping — Ctrl-C to stop and remove the players\n' : '')

  for (let pass = 1; ; pass++) {
    if (looping) log(`  ── pass ${pass}`)
    for (const step of steps) {
      const [verb, arg = ''] = step.split(':')
      log(`  ${step}`)

      switch (verb) {
        case 'join':
          for (const name of arg.split(',').filter(Boolean)) {
            // Idempotent, so a looping script keeps the same four players instead
            // of stacking four more onto the board every pass.
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
          // Wait for the real armedAt rather than guessing it: every offset in a
          // buzz step is measured from that instant, and the whole point of this
          // tool is that the numbers you type are the numbers you get.
          await host.waitFor((s) => s.round.phase === 'ARMED')
          break
        }

        case 'buzz': {
          const armedAt = host.state()?.round.armedAt ?? 0
          if (!armedAt) throw new Error('buzz before arm — nothing is open')
          let last = 0
          for (const spec of arg.split(',').filter(Boolean)) {
            const [name, offset = '0'] = spec.split('@')
            const conn = players.get(name)
            if (!conn) throw new Error(`${name} has not joined — add them to a join: step`)
            const pressAt = armedAt + Number(offset)
            last = Math.max(last, Number(offset))
            // Sent at the press instant, not scheduled ahead of it: an early
            // packet is dropped by the hub, so faking the send would probe a
            // path the game does not have. Pressing in real time is also what
            // makes the marks land on the board one at a time.
            void sleep(Math.max(0, pressAt - conn.now())).then(() =>
              conn.send({ t: 'buzz', at: pressAt }),
            )
          }
          // Hold until the window has actually shut and the order is published.
          // Measured from the last press, not from now: a script that opens with
          // an idle beat before anyone buzzes would otherwise walk on to the next
          // step mid-collection. ARM_LEAD_MS covers a not-yet-open buzzer.
          await sleep(
            Math.max(0, armedAt + last + COLLECT_MS + ARM_LEAD_MS - host.now()),
          )
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
  // Nothing to tear down: the board is showing server state, not something this
  // process is holding up. Exiting leaves the last frame exactly where it is —
  // which is the whole point of a one-shot command. `clear` when you want the
  // players gone.
  process.exit(0)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
