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
 *   pack:name.txt    pick a pack and wait out its synthesis
 *   autoplay:on:4:2  autoplay on, payoff dwell, rebound pause (seconds)
 *   rewind           forget where every pack got to, so a walkthrough repeats exactly
 *   read             start the reader on the chosen pack or the block's
 *   armed            wait for the buzzers to open — the reader arms, not you
 *   mode:trivia      pin the mode (resets scores, as a host mode switch does)
 *   direct           drop any setlist — the one step that touches a setlist probe did not set
 *   act:name[:data]  host-scoped act (fragment / powerEnds / revealAnswer)
 *   speak:A=text     A's transcript, POSTed as text/plain into the judge
 *   say:A=words      the same, but spoken: `say` renders the words to a clip and
 *                    the clip goes in as audio, so STT and the matcher both run
 *   teams:R=A,B/S=C  teams grouping, those teams, those players on them
 *   setlist:t*2@p.txt,q*1:v
 *                    setlist: mode*count blocks, @pack the reader takes that
 *                    block's questions from, a trailing :rule opens a duel for
 *                    the block it follows
 *   jump:1           jump the setlist to that block index
 *   duel:vote        open a heads-up duel under that rule id
 *   in:A,B | out:A   volunteer / back off, from those players' own sockets
 *   vote:A=B,C=B     A votes for B, C votes for B (`=`, not `>`: no quoting)
 *   unvote:A         A takes their vote back — the tally counts down
 *   seat[:A,B]       close the window: resolve by rule, or seat those two
 *   cancel           call the duel off
 *   wait:1200        hold, in ms — the only step that exists for your eyes
 *   clear            put the room back: duel off, teams undone, players gone
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
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, reachable, type Conn } from './conn.ts'
import { clipPath, run } from '../server/speech.ts'
import { ARM_DELAY_MS, COLLECT_MS } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const URL = process.env.URL ?? (await reachable())

const log = (s = '') => console.log(s)

/**
 * An answer, spoken. `say` renders the words to a clip and `say:` posts the
 * clip, so the whole path a real phone takes — transcription, then the fuzzy
 * matcher — runs on a walkthrough instead of being skipped by `speak:`'s
 * text/plain shortcut.
 *
 * Cached beside the reader's own clips and by the same rule, so a walkthrough
 * re-run costs nothing: the second run posts a file that is already there. WAV
 * rather than the reader's AIFF because the extension is what tells `say` the
 * container, and the judge writes what it receives to a `.wav` temp path.
 *
 * A voice of its own, because an answer in the reader's voice sounds like the
 * box marking its own homework. Any macOS missing it falls back to the default
 * rather than failing the walkthrough over a preference.
 */
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
    // The header comment is the manual; printing a second copy is a second
    // thing to keep true.
    log('\n  usage: npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@120 correct')
    log('  steps: loop join value arm buzz correct wrong next reset undo pack mode direct autoplay rewind read armed act speak say teams setlist jump duel in out vote unvote seat cancel wait clear')
    log('  walks: npm run walk-duel   walk-teams   walk-setlist   walk-read   walk-packs\n')
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

  /** A player probe is driving, or the error that says to join them first. */
  const player = (name: string) => {
    const conn = players.get(name)
    if (!conn) throw new Error(`${name} has not joined — add them to a join: step`)
    return conn
  }

  /**
   * Players probe put on a team, and whether probe is the one who turned teams
   * on. Both exist so `clear` can undo exactly what this run did and nothing
   * else: a borrowed phone gets taken off its team again, but a room the host
   * had already set up a teams grouping before probe arrived is left in it.
   */
  const assigned = new Set<string>()
  let teamsAreOurs = false
  let setlistIsOurs = false
  let readIsOurs = false
  let autoplayIsOurs = false

  const clear = () => {
    // The reader first: one still running would arm the next question straight
    // back over the top of everything below, and autoplay would then walk the
    // room on by itself while this function is still tidying up.
    if (readIsOurs) host.send({ t: 'act', act: 'stopRead' })
    if (autoplayIsOurs) {
      host.send({ t: 'host', action: { a: 'setAutoplay', on: false, nextSec: 5, reboundSec: 2 } })
    }
    // Then the round: clearSetlist is refused unless it is IDLE, so resetting here
    // before anything IDLE-gated runs is what makes a `clear` mid-question
    // actually clear rather than leave the setlist armed for the next `next`.
    host.send({ t: 'host', action: { a: 'next' } })
    if (setlistIsOurs) host.send({ t: 'host', action: { a: 'clearSetlist' } })
    host.send({ t: 'host', action: { a: 'cancelDuel' } })
    // Before the kick: an assign for a player who is already gone does nothing.
    for (const playerId of assigned) host.send({ t: 'host', action: { a: 'assign', playerId } })
    if (teamsAreOurs) host.send({ t: 'host', action: { a: 'setGrouping', grouping: 'solo' } })
    const gone = (host.state()?.players ?? []).filter((p) => p.id.startsWith('probe-'))
    for (const p of gone) host.send({ t: 'host', action: { a: 'kick', playerId: p.id } })
    log(`  cleared ${gone.length}`)
  }
  process.on('SIGINT', () => setTimeout(() => process.exit(0), 100))

  log(`\n  Party Buzzer — probe against ${URL}`)
  log(looping ? '  looping — Ctrl-C to stop and remove the players\n' : '')

  for (let pass = 1; ; pass++) {
    if (looping) log(`  ── pass ${pass}`)
    for (const step of steps) {
      // First colon only: `setlist:trivia*2,quizbowl*1:vote` has to keep the
      // duel rule attached, and an act's data can itself hold colons — a full
      // split-and-take-two would silently drop everything past the second one.
      const sep = step.indexOf(':')
      const verb = sep === -1 ? step : step.slice(0, sep)
      const arg = sep === -1 ? '' : step.slice(sep + 1)
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
            const conn = player(name)
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
          // Hold until the order is actually published.
          //
          // Counted from now, never forward from `armedAt`: those are the same
          // instant only when the buzz step follows the arm immediately. With a
          // `wait:` between them — as a paced walkthrough must have — an
          // `armedAt` sum lands in the past, the step returns at once, and the
          // host action after it fires mid-collection, where `wrong` with no
          // leader yet does nothing at all, silently.
          //
          // So watch the phase instead, and keep the arithmetic only as the
          // ceiling for the case where nothing locks because every press was
          // dropped — a spectator's, in a duel.
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

        // pack:walk-a.txt — pick it and wait out the synthesis, so the step
        // after this one is not racing a render that takes half a minute the
        // first time it runs.
        case 'pack': {
          host.send({ t: 'act', act: 'selectPack', data: arg })
          await host.waitFor((s) => s.reading?.pack === arg && !s.reading.rendering, 180_000)
          readIsOurs = true
          log(`  pack ${arg} (${host.state()?.reading?.qTotal} questions)`)
          break
        }

        // autoplay:on:4:2 — on, four seconds on the payoff, two on a rebound.
        case 'autoplay': {
          const [on, next = '4', rebound = '2'] = arg.split(':')
          host.send({
            t: 'host',
            action: {
              a: 'setAutoplay',
              on: on !== 'off',
              nextSec: Number(next),
              reboundSec: Number(rebound),
            },
          })
          autoplayIsOurs = true
          break
        }

        // mode:trivia — pin the mode, because a walkthrough that scores 250 in
        // one room and 200 in the next is not repeatable. Resets the scores,
        // like the host's own mode switch does.
        case 'mode':
          host.send({ t: 'host', action: { a: 'setMode', id: arg, options: {} } })
          await host.waitFor((s) => s.game.id === arg, 3000)
          break

        // The one step that touches a setlist probe did not set: a direct-play
        // script cannot run against a room in setlist mode, because the block
        // is what names the pack. Destructive, and only ever asked for.
        case 'direct':
          host.send({ t: 'host', action: { a: 'clearSetlist' } })
          await host.waitFor((s) => !s.setlist, 3000).catch(() => {})
          break

        // Forget where every pack got to, so a walkthrough starts from the same
        // frame however the last one ended. Read normally resumes.
        case 'rewind':
          host.send({ t: 'act', act: 'rewindRead' })
          break

        case 'read':
          host.send({ t: 'act', act: 'read' })
          readIsOurs = true
          // A reader with nothing to read stops immediately and says nothing,
          // and the next `armed` then hangs for a minute on a question that is
          // never coming. Name the cause here instead.
          await host.waitFor((s) => !!s.reading?.running, 3000).catch(() => {
            throw new Error(
              'read did nothing — no pack is selected, or the setlist block the ' +
                'room is on names none. `direct` first, or give the block a pack.',
            )
          })
          break

        // The reader arms, not you. Everything a buzz step measures is taken
        // from the arm instant, so a scripted press against a read pack has to
        // wait for the reader to get there first.
        case 'armed':
          // Generous, because a setlist renders every pack it names before its
          // first question and the very first run on a machine is doing that
          // from cold — minutes of `say`, once, and instant on every run after.
          // `read` has already caught the common failure (nothing to read) in
          // three seconds, so a long wait here only ever means a real stall.
          await host.waitFor((s) => s.round.phase === 'ARMED', 300_000)
          break

        case 'act': {
          // Host-scoped acts, the reader's channel: act:fragment:Some text,
          // act:powerEnds, act:revealAnswer:The answer. Item uses go through
          // unit tests; probe's players have no inventory of their own.
          const [name, ...rest] = arg.split(':')
          host.send({ t: 'act', act: name, data: rest.join(':') || undefined })
          break
        }

        // speak:Ada=green mountain state — the transcript POSTed as text/plain,
        // skipping STT, so a whole spoken round is one command. Quote the step:
        // npm run probe -- 'speak:Ada=green mountain state'
        // say:Ada=the Pacific Ocean — the same, spoken. Quote it too.
        case 'speak':
        case 'say': {
          const [name, ...rest] = arg.split('=')
          const text = rest.join('=')
          if (!name || !text) throw new Error(`${verb} needs Name=words`)
          const conn = player(name)
          // Render before waiting: the clip is cached after the first run, but
          // the first run must not spend the answer window on `say`.
          const clip = verb === 'say' ? await sayClip(text) : ''
          // Wait for the judge's window rather than assuming the lock: the
          // round must have locked with this player first and the judge primed.
          // No window inside ten seconds means the judge is off — no `swiftc`,
          // no speech source — and a spoken walkthrough cannot run without it.
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

        // teams:Red=Ada,Bo/Blue=Cy,Dee — mode, teams and assignments in one
        // step. A team of that name already in the room is reused rather than
        // added twice, the same way `join` borrows a player who is already
        // here.
        //
        // ponytail: the teams it does add outlive `clear`, because the protocol
        // has no removeTeam — they go back to being invisible when the mode
        // returns to solo, and the next run reuses them by name. Add the action
        // if a stale team ever actually gets in the way.
        case 'teams': {
          // Only if it is not already on. `setGrouping` drops an open duel, so
          // re-sending it to add one late player would cancel the window you
          // were about to watch.
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

        // setlist:trivia*3@walk-a.txt,quizbowl*2:vote — mode*count, optionally
        // @pack for the reader to take that block's questions from, optionally
        // :duelRule. Both suffixes are optional and either order of reading
        // them is unambiguous: a pack name holds no colon and a rule id no @.
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
          await host.waitFor((s) => s.setlist?.blocks.length === blocks.length)
          setlistIsOurs = true
          log(`  setlist ${blocks.length} blocks`)
          break
        }

        case 'jump':
          host.send({ t: 'host', action: { a: 'setlistJump', at: Number(arg) } })
          break

        case 'duel':
          host.send({ t: 'host', action: { a: 'openDuel', rule: arg } })
          break

        // Entry acts ride each player's own socket, not the host's: the hub
        // drops a `duel*` act from a connection with no playerId, which is the
        // rule this tool exists to exercise rather than route around.
        case 'in':
        case 'out':
          for (const name of arg.split(',').filter(Boolean))
            player(name).send({
              t: 'act',
              act: verb === 'in' ? 'duelVolunteer' : 'duelBackOff',
            })
          break

        case 'vote':
          for (const pair of arg.split(',').filter(Boolean)) {
            const [voter, target] = pair.split('=')
            if (!target) throw new Error(`vote needs voter=target, got "${pair}"`)
            player(voter).send({ t: 'act', act: 'duelVote', data: idFor(target) })
            // Spaced, because a tally that jumps from nothing to three in one
            // frame is a number rather than a room making up its mind.
            await sleep(250)
          }
          break

        case 'unvote':
          for (const name of arg.split(',').filter(Boolean)) {
            const held = host
              .state()
              ?.duel?.pool.find((e) => e.votes.includes(idFor(name)))
            if (!held) throw new Error(`${name} has no vote to take back`)
            // Withdrawing is voting again for the same name — the server reads
            // the repeat as the undo, so probe sends exactly what a phone does.
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
