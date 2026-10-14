/**
 * Synthetic self-play for Sketch. Eight bots join and play one match: a drawer
 * picks a word and scribbles; guessers send wrong guesses, the odd close one,
 * and the right answer once their skill allows. Phones already in the room play
 * along. The log names each drawer and word.
 *
 *   npm run sim-sketch
 *   npm run sim-sketch -- 400                  one bot action every 0.4 s
 *   npm run sim-sketch -- 400 http://box:8080
 *
 * The match ends on its own; Ctrl-C ends it early. Either way the minigame
 * closes and the bots leave.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable } from './conn.ts'
import type { SketchInput } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const TICK_MS = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 600)
const URL = await reachable(args.find((arg) => arg.startsWith('http')))
const NAMES = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']
const WRONG = ['cat', 'house', 'a sad dog', 'PANCAKE', 'banana??', 'the moon', 'spaghetti', 'a potato', 'is that a horse', 'robot']
const RESULTS_MS = 8_000

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]
const scribble = () => {
  let x = 0.2 + Math.random() * 0.6
  let y = 0.2 + Math.random() * 0.6
  return Array.from({ length: 20 }, () => {
    x = Math.min(0.95, Math.max(0.05, x + (Math.random() - 0.5) * 0.12))
    y = Math.min(0.95, Math.max(0.05, y + (Math.random() - 0.5) * 0.12))
    return [x, y] as [number, number]
  })
}

const host = await connect(URL, 'host')
const bots: { conn: Awaited<ReturnType<typeof connect>>; name: string; seq: number; skill: number }[] = []
for (const [i, name] of NAMES.entries()) {
  const conn = await connect(URL, 'player', name, `sim-sketch-${name}`)
  // Sequence numbers start from the clock so a rerun never reuses remembered ones.
  // Skill is how many of this bot's actions into a drawing it can get the word.
  bots.push({ conn, name, seq: Date.now(), skill: 4 + i * 2 })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  host.send({ t: 'host', action: { a: 'next' } })
  for (const bot of bots) {
    bot.conn.close()
    host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
  }
  console.log('Game closed, bots removed.')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)

host.send({ t: 'host', action: { a: 'cancelMinigame' } })
host.send({ t: 'host', action: { a: 'closeMinigame' } })
host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'sketch', options: { drawSec: 45 } } })
await host.waitFor((s) => s.minigame?.id === 'sketch' && s.minigame.phase === 'ready')
host.send({ t: 'host', action: { a: 'startMinigame' } })
await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = host.state()!.minigame!.matchId

/** The sim cheats: a drawer bot's frame carries the word, so guessers can get it. */
const wordNow = () => {
  for (const bot of bots) {
    const frame = bot.conn.frame()
    if (frame?.role === 'player' && frame.id === 'sketch' && frame.drawer === bot.conn.playerId && frame.word) return frame.word
  }
  return null
}

let turn = -1
let actions = 0
while (host.state()?.minigame?.phase === 'playing') {
  const word = wordNow()
  for (const bot of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'sketch' || frame.matchId !== matchId) continue
    const send = (input: { kind: string } & Record<string, unknown>) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as SketchInput })
    if (frame.turn !== turn) {
      turn = frame.turn
      actions = 0
    }
    const me = bot.conn.playerId
    if (frame.drawer === me) {
      if (frame.step === 'choosing' && frame.choices.length) {
        const index = Math.floor(Math.random() * frame.choices.length)
        console.log(`Turn ${frame.turn + 1}/${frame.turns}: ${bot.name} draws "${frame.choices[index]}"`)
        send({ kind: 'pickWord', index })
      } else if (frame.step === 'drawing') send({ kind: 'stroke', points: scribble() })
      continue
    }
    if (frame.step !== 'drawing' || frame.correct.some((c) => c.player === me) || Math.random() < 0.5) continue
    if (word && actions >= bot.skill) send({ kind: 'guess', text: word })
    else if (word && word.length >= 4 && Math.random() < 0.2) send({ kind: 'guess', text: word.slice(0, -1) })
    else send({ kind: 'guess', text: pick(WRONG) })
  }
  actions++
  await sleep(TICK_MS)
}

const names = new Map(host.state()?.players.map((p) => [p.id, p.name]))
for (const result of host.state()?.minigame?.results ?? []) console.log(`${names.get(result.playerId) ?? result.playerId}: ${result.points}`)
await sleep(RESULTS_MS)
stop()
