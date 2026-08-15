/**
 * The reader: speaks a question pack aloud, fragment by fragment, and drives
 * the game in time with its own voice.
 *
 *   npm run read -- pack.txt                  against http://localhost:8080
 *   npm run read -- pack.txt http://box:8080  against another host
 *
 * The pack is this tool's alone — the server never sees question content
 * beyond the fragments the room has heard. Each fragment goes up on the
 * board as it is spoken; when the configured power fragment has been said,
 * the reader fires `powerEnds` and the window closes behind it. No reader,
 * no cutoff: power simply stays open all question.
 *
 * The human host still judges. C and W on the host screen score the round as
 * always — a wrong answer re-arms for a rebound and the reader waits it out
 * (the fragments have all been said). When the question resolves, the answer
 * goes up on the board; the host's N then releases the next question.
 *
 * Speech is macOS `say`. On a machine without it the wire protocol still runs
 * — fragments appear, power closes — just silently.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { connect } from './conn.ts'
import { parsePack } from './pack.ts'

const [packPath, argUrl] = process.argv.slice(2)
const URL = argUrl ?? process.env.URL ?? 'http://localhost:8080'

const log = (s = '') => console.log(s)

/** One fragment aloud. Resolves when the voice finishes, or at once without `say`. */
function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn('say', [text])
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
}

async function main() {
  if (!packPath) {
    log('\n  usage: npm run read -- pack.txt [url]\n')
    return
  }
  const { questions, errors } = parsePack(readFileSync(packPath, 'utf8'))
  for (const e of errors) log(`  skipped: ${e}`)
  if (questions.length === 0) {
    console.error('\n  no usable questions in the pack\n')
    process.exit(1)
  }

  const host = await connect(URL, 'host')
  // The host releases each question with N; some waits are a room's patience,
  // not a timeout in any meaningful sense.
  const PATIENCE = 30 * 60_000

  log(`\n  Party Buzzer — reading ${questions.length} questions against ${URL}`)
  log('  you judge on the host screen: C correct, W wrong, N next. Ctrl-C to stop.\n')
  process.on('SIGINT', () => process.exit(0))

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    log(`  ── Q${i + 1}/${questions.length}${q.value !== undefined ? `  (${q.value})` : ''}`)

    if (q.value !== undefined) host.send({ t: 'host', action: { a: 'setValue', value: q.value } })
    host.send({ t: 'host', action: { a: 'arm' } })
    const armed = await host.waitFor((s) => s.round.phase === 'ARMED')
    // Let the buzzers actually open before the first word.
    await sleep(Math.max(0, armed.round.armedAt - host.now()))

    const powerAfter = Number(armed.game.options.powerAfterFragment ?? 0)
    for (let f = 0; f < q.fragments.length; f++) {
      host.send({ t: 'act', act: 'fragment', data: q.fragments[f] })
      await say(q.fragments[f])
      if (powerAfter > 0 && f + 1 === powerAfter) host.send({ t: 'act', act: 'powerEnds' })
    }

    // The host judges from here. Wrong answers re-arm for a rebound; the
    // reader waits it out — the question has all been said. Resolved means:
    // scored (award set), or passed (N with nobody left in the round).
    await host.waitFor(
      (s) =>
        s.round.phase === 'IDLE' &&
        (!!s.round.award || (s.round.order.length === 0 && s.round.lockedOut.length === 0)),
      PATIENCE,
    )
    if (host.state()?.round.award) host.send({ t: 'act', act: 'revealAnswer', data: q.answer })

    // Let the payoff sit on the wall. The host's N clears it and releases us.
    await host.waitFor((s) => s.round.phase === 'IDLE' && !s.round.award, PATIENCE)
  }

  log('\n  pack finished.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
