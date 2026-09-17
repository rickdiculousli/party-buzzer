/**
 * Synthetic self-play for Phantom Ink. Eight bots join, crowd onto Sun until it
 * is over capacity, then two move to Moon, volunteer, and play until a team
 * wins or the pad fills. Each team has three Guessers: they tap the options they
 * are voting on, split their votes, drift toward the leading choice, and Force a stalled vote. Writers scribble random letters,
 * and a guessing bot types a random letter, which the server checks against the secret word.
 * A team with a borrowed phone types its own guesses; bots on it leave the keyboard alone.
 * Needs packs/phantom-ink.txt on the server.
 *
 *   npm run sim-ink
 *   npm run sim-ink -- 2500                  one bot action every 2.5 s
 *   npm run sim-ink -- 2500 http://box:8080
 *
 * Join a phone under a bot's name (Ivy, Jax, Kai, Lux, Mo, Rex, Sol, Tia) before running
 * to watch that bot's view; the bot plays for it. Ivy and Lux are the Writers.
 *
 * Ctrl-C closes the minigame and removes the bots it created.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import type { InkInput, LobbyChange, State } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const TICK_MS = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 700)
const URL = args.find((arg) => arg.startsWith('http')) ?? (await reachable())
const NAMES = ['Ivy', 'Jax', 'Kai', 'Lux', 'Mo', 'Rex', 'Sol', 'Tia']
const START_MOON = new Set(['Rex', 'Sol'])
/** Everyone else crowds onto Sun first; these two then move to Moon. */
const MOVERS = new Set(['Lux', 'Mo'])
const VOLUNTEERS = new Set(['Ivy', 'Lux'])
const LOBBY_MS = Math.max(300, TICK_MS / 2)

const host = await connect(URL, 'host')
const bots = new Map<string, { conn: Conn; seq: number; name: string; borrowed: boolean }>()
for (const name of NAMES) {
  // A phone already in the room under a bot's name is borrowed: the bot plays
  // for it and that phone shows the bot's view. Borrowed players are never kicked.
  const existing = host.state()?.players.find((p) => p.name === name)?.id
  const conn = await connect(URL, 'player', name, existing ?? `sim-ink-${name}`)
  // Sequence numbers start from the clock so a rerun never reuses remembered ones.
  bots.set(conn.playerId, { conn, seq: Date.now(), name, borrowed: !!existing && !existing.startsWith('sim-ink-') })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  for (const bot of bots.values()) {
    bot.conn.close()
    if (!bot.borrowed) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
  }
  console.log('Game closed, bots removed.')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)

// A game left over from an earlier run would refuse the prepare.
host.send({ t: 'host', action: { a: 'cancelMinigame' } })
host.send({ t: 'host', action: { a: 'closeMinigame' } })
host.send({ t: 'host', action: { a: 'prepareMinigame', id: 'ink', options: {} } })
await host.waitFor((s) => s.minigame?.id === 'ink' && s.minigame.phase === 'ready')
const lobby = async (bot: { conn: Conn }, change: LobbyChange) => {
  bot.conn.send({ t: 'minigameLobby', change })
  await sleep(LOBBY_MS)
}
for (const bot of bots.values()) await lobby(bot, { do: 'join', team: START_MOON.has(bot.name) ? 'moon' : 'sun' })
await sleep(LOBBY_MS * 3)
for (const bot of bots.values()) if (MOVERS.has(bot.name)) await lobby(bot, { do: 'join', team: 'moon' })
for (const bot of bots.values()) if (VOLUNTEERS.has(bot.name)) await lobby(bot, { do: 'volunteer', on: true })
// Start needs every connected player on a team, and only bots are picked here.
const unpicked = (s: State) =>
  s.players.filter((p) => p.connected && !s.minigame?.lobby?.teams[p.id]).map((p) => p.name)
const waiting = unpicked(host.state()!)
if (waiting.length) {
  console.log(`Waiting up to 60 s for ${waiting.join(', ')} to join a team or disconnect.`)
  try {
    await host.waitFor((s) => unpicked(s).length === 0, 60_000)
  } catch {
    console.log(`Still unpicked: ${unpicked(host.state()!).join(', ')}. Close those tabs or kick them on /host.`)
    stop()
    await sleep(1_000)
  }
}
host.send({ t: 'host', action: { a: 'startMinigame' } })
const state = await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = state.minigame!.matchId

const letter = (): [number, number][] => {
  const x = Math.random() * 0.8 + 0.1
  return Array.from({ length: 8 }, (_, i) => [Math.min(1, x + i * 0.005), 0.2 + i * 0.08])
}

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
const leading = (votes: { choice: string }[]) => {
  const counts = new Map<string, number>()
  for (const vote of votes) counts.set(vote.choice, (counts.get(vote.choice) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
/** Ticks each vote has run without resolving, keyed by turn, row and step. */
const stalls = new Map<string, number>()
/** Ticks each bot has spent looking at a vote before its first vote, keyed by bot and vote. */
const looks = new Map<string, number>()
const FORCE_AFTER_TICKS = 8
/** Peeks get a longer look: bots tap around the rows for this many ticks before voting. */
const PEEK_LOOK_TICKS = 5
const GUESS_AFTER_CLUES = 4

/** The team of a bot's phone, once it holds an ink frame. */
const teamOf = (bot: { conn: Conn }) => {
  const frame = bot.conn.frame()
  return frame?.role === 'player' && frame.id === 'ink' ? frame.me.team : null
}
/** A team with a borrowed phone on it spells its own guesses; no bot there types a letter. */
const humanGuess = (team: string) => [...bots.values()].some((bot) => bot.borrowed && teamOf(bot) === team)

while (host.state()?.minigame?.phase === 'playing') {
  await sleep(TICK_MS)
  const forcedThisTick = new Set<string>()
  for (const [id, bot] of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'ink' || frame.matchId !== matchId) continue
    const send = (input: { kind: string } & Record<string, unknown>) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as InkInput })
    // One to three quick taps close together, like a finger pointing.
    const tap = async (target: string) => {
      const x = 0.15 + Math.random() * 0.7
      const y = 0.2 + Math.random() * 0.6
      const jitter = (n: number) => Math.min(1, Math.max(0, n + (Math.random() - 0.5) * 0.08))
      for (let i = 1 + Math.floor(Math.random() * 3); i > 0; i--) {
        bot.conn.send({ t: 'minigameTouch', matchId, target, x: jitter(x), y: jitter(y) })
        await sleep(80 + Math.random() * 100)
      }
    }
    const s = frame.step
    const ours = frame.me.team === frame.turn
    const writer = frame.me.role === 'writer'
    const pad = frame.pad

    // Guessers vote like people: a first opinion, drifting to the leader, and a Force when it stalls.
    const castVote = (options: string[], preferred: string, targetOf: (choice: string) => string[], lookTicks = 0) => {
      const key = `${frame.turn}:${frame.row}:${s.at}`
      const mine = frame.votes.find((vote) => vote.player === id)?.choice
      const leader = leading(frame.votes)
      const looked = (looks.get(`${id}:${key}`) ?? 0) + 1
      looks.set(`${id}:${key}`, looked)
      if (!mine && looked <= lookTicks) {
        void tap(targetOf(pick(options))[0])
        return
      }
      if (Math.random() < 0.6) for (const target of targetOf(mine ?? preferred)) void tap(target)
      if (!mine) {
        send({ kind: 'vote', choice: Math.random() < 0.6 ? preferred : pick(options) })
        return
      }
      if (leader && mine !== leader && Math.random() < 0.5) {
        send({ kind: 'vote', choice: leader })
        return
      }
      const ticks = (stalls.get(key) ?? 0) + 1
      stalls.set(key, ticks)
      if (ticks > FORCE_AFTER_TICKS * frame.roster[frame.turn].guessers.length && !forcedThisTick.has(key)) {
        forcedThisTick.add(key)
        console.log(`${bot.name} forces ${s.at} (${leader})`)
        send({ kind: 'force' })
      }
    }

    if (s.at === 'choosing' && writer) send({ kind: 'pickWord', index: 0 })
    else if (s.at === 'peekPick' && ours && !writer) {
      castVote(s.targets, s.targets[0], (choice) => [`row:${choice}`], PEEK_LOOK_TICKS)
    } else if (s.at === 'peekWrite' && frame.roster[s.team].writer === id) {
      send({ kind: 'stroke', points: letter() })
      await sleep(200)
      send({ kind: 'done' })
    } else if (s.at === 'choose' && ours && !writer) {
      const clues = pad?.[frame.turn].filter((row) => row.kind === 'clue').length ?? 0
      // Guessing waits until both teams have passed a peek row; early splits are Ask versus Redraw.
      const ready = clues >= GUESS_AFTER_CLUES
      const options = ready ? ['ask', 'guess'] : ['ask', ...(s.canRedraw ? ['redraw'] : [])]
      castVote(options, ready ? 'guess' : 'ask', (choice) => [`vote:${choice}`])
    } else if (s.at === 'offer' && ours && !writer) {
      const ids = frame.hand.map((card) => card.id)
      const pairs = [[ids[0], ids[1]], [ids[0], ids[2]], [ids[1], ids[2]]].map((pair) => pair.sort((a, b) => a - b).join(','))
      castVote(pairs, pairs[0], (choice) => choice.split(',').map((card) => `card:${card}`))
    } else if (s.at === 'keep' && ours && writer) send({ kind: 'keep', prompt: pick(frame.offered).id })
    else if (s.at === 'clue' && ours && writer) send(s.stopped ? { kind: 'done' } : { kind: 'stroke', points: letter() })
    else if (s.at === 'clue' && ours && !writer) {
      if ((pad?.[frame.turn][frame.row].strokes.length ?? 0) >= 2 && Math.random() < 0.5) send({ kind: 'stop' })
    } else if (s.at === 'guess' && ours && !writer && (s.holder === null || s.holder === id)) {
      // A guess is the one thing borrowed phones keep: no bot claims the row or types over
      // the person. Bots guessing alone cannot see the secret, so they spell in the dark.
      if (!humanGuess(frame.turn)) send({ kind: 'letter', value: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)] })
    }
  }
}
console.log('Game over:', JSON.stringify(host.state()?.minigame?.results))
await sleep(3_000)
stop()
