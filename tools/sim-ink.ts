/**
 * Synthetic self-play for Phantom Ink. Five bots join, pick teams, volunteer
 * and play until a team wins or the pad fills. Writers scribble random letters,
 * guessers stop after two letters and finish their guess once it has three.
 * Needs packs/phantom-ink.txt on the server.
 *
 *   npm run sim-ink
 *   npm run sim-ink -- http://box:8080
 *
 * Ctrl-C closes the minigame and removes the bots.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import type { InkInput, MinigameFrame } from '../shared/protocol.ts'

const URL = process.argv[2] ?? (await reachable())
const TEAMS = { Ivy: 'sun', Jax: 'sun', Kai: 'sun', Lux: 'moon', Mo: 'moon' } as const
const VOLUNTEERS = new Set(['Ivy', 'Lux'])

const host = await connect(URL, 'host')
const bots = new Map<string, { conn: Conn; seq: number }>()
for (const name of Object.keys(TEAMS)) {
  const conn = await connect(URL, 'player', name, `sim-ink-${name}`)
  bots.set(conn.playerId, { conn, seq: 1 })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  for (const bot of bots.values()) bot.conn.close()
  host.close()
}
process.on('SIGINT', () => { stop(); process.exit(0) })

host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'ink', options: {} } })
await host.waitFor((s) => s.minigame?.id === 'ink' && s.minigame.phase === 'ready')
for (const bot of bots.values()) {
  const name = bot.conn.state()?.players.find((p) => p.id === bot.conn.playerId)?.name as keyof typeof TEAMS
  bot.conn.send({ t: 'minigameLobby', change: { do: 'join', team: TEAMS[name] } })
  await sleep(300)
  if (VOLUNTEERS.has(name)) bot.conn.send({ t: 'minigameLobby', change: { do: 'volunteer', on: true } })
  await sleep(300)
}
host.send({ t: 'host', action: { a: 'startMinigame' } })
const state = await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = state.minigame!.matchId

const letter = (): [number, number][] => {
  const x = Math.random() * 0.8 + 0.1
  return Array.from({ length: 8 }, (_, i) => [Math.min(1, x + i * 0.005), 0.2 + i * 0.08])
}

while (host.state()?.minigame?.phase === 'playing') {
  await sleep(700)
  for (const [id, bot] of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'ink' || frame.matchId !== matchId) continue
    const send = (input: Omit<InkInput, 'at'> & { kind: string }) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as InkInput })
    const s = frame.step
    const ours = frame.me.team === frame.turn
    const writer = frame.me.role === 'writer'
    const pad = frame.pad
    if (s.at === 'choosing' && writer) send({ kind: 'pickWord', index: 0 })
    else if (s.at === 'peekPick' && ours && !writer) send({ kind: 'vote', choice: s.targets[0] })
    else if (s.at === 'peekWrite' && frame.roster[s.team].writer === id) {
      send({ kind: 'stroke', points: letter() })
      await sleep(200)
      send({ kind: 'done' })
    } else if (s.at === 'choose' && ours && !writer) {
      const clues = pad?.[frame.turn].filter((row) => row.kind === 'clue').length ?? 0
      send({ kind: 'vote', choice: clues >= 3 ? 'guess' : 'ask' })
    } else if (s.at === 'offer' && ours && !writer) send({ kind: 'vote', choice: `${frame.hand[0].id},${frame.hand[1].id}` })
    else if (s.at === 'keep' && ours && writer) send({ kind: 'keep', prompt: frame.offered[0].id })
    else if (s.at === 'clue' && ours && writer) send(s.stopped ? { kind: 'done' } : { kind: 'stroke', points: letter() })
    else if (s.at === 'clue' && ours && !writer && (pad?.[frame.turn][frame.row].strokes.length ?? 0) >= 2) send({ kind: 'stop' })
    else if (s.at === 'guess' && ours && !writer && (s.holder === null || s.holder === id)) {
      const row = pad?.[frame.turn][frame.row]
      if ((row?.strokes.length ?? 0) >= 3) send({ kind: 'finishGuess' })
      else {
        send({ kind: 'stroke', points: letter() })
        await sleep(200)
        send({ kind: 'check' })
      }
    } else if (s.at === 'judgeLetter' && ours && writer) send({ kind: 'judge', correct: Math.random() < 0.7 })
    else if (s.at === 'judgeWord' && ours && writer) send({ kind: 'verdict', win: Math.random() < 0.5 })
  }
}
console.log('Game over:', JSON.stringify(host.state()?.minigame?.results))
await sleep(3_000)
stop()
