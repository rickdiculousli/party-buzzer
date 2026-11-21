import { setTimeout as sleep } from 'node:timers/promises'
import { connect, reachable, type Conn } from './conn.ts'
import { link } from '../server/net.ts'
import type { InkInput, LobbyChange, State } from '../shared/protocol.ts'

const args = process.argv.slice(2)
const TICK_MS = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 700)
const URL = await reachable(args.find((arg) => arg.startsWith('http')))
const NAMES = ['Ivy', 'Jax', 'Kai', 'Lux', 'Mo', 'Rex', 'Sol', 'Tia']
const START_MOON = new Set(['Rex', 'Sol'])
const MOVERS = new Set(['Lux', 'Mo'])
const VOLUNTEERS = new Set(['Ivy', 'Lux'])
const LOBBY_MS = Math.max(300, TICK_MS / 2)

const host = await connect(URL, 'host')
const bots = new Map<string, { conn: Conn; seq: number; name: string; borrowed: boolean }>()
for (const name of NAMES) {
  const existing = host.state()?.players.find((p) => p.name === name)?.id
  const conn = await connect(URL, 'player', name, existing ?? `sim-ink-${name}`)
  bots.set(conn.playerId, { conn, seq: Date.now(), name, borrowed: !!existing && !existing.startsWith('sim-ink-') })
}

const stop = () => {
  host.send({ t: 'host', action: { a: 'cancelMinigame' } })
  host.send({ t: 'host', action: { a: 'closeMinigame' } })
  host.send({ t: 'host', action: { a: 'next' } })
  for (const bot of bots.values()) {
    bot.conn.close()
    if (!bot.borrowed) host.send({ t: 'host', action: { a: 'kick', playerId: bot.conn.playerId } })
  }
  console.log('Game closed, bots removed.')
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)

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
const unpicked = (s: State) =>
  s.players.filter((p) => p.connected && !s.minigame?.lobby?.teams[p.id]).map((p) => p.name)
const waiting = unpicked(host.state()!)
if (waiting.length) {
  console.log(`Waiting up to 60 s for ${waiting.join(', ')} to join a team or disconnect.`)
  try {
    await host.waitFor((s) => unpicked(s).length === 0, 60_000)
  } catch {
    console.log(`Still unpicked: ${unpicked(host.state()!).join(', ')}. Close those tabs or kick them on ${link(`${URL}/host`)}.`)
    stop()
    await sleep(1_000)
  }
}
host.send({ t: 'host', action: { a: 'startMinigame' } })
const state = await host.waitFor((s) => s.minigame?.phase === 'playing', 10_000)
const matchId = state.minigame!.matchId

const GLYPHS: Record<string, string> = {
  A: '0,1 0.5,0 1,1|0.25,0.55 0.75,0.55',
  C: '1,0.15 0.6,0 0.2,0.1 0,0.5 0.2,0.9 0.6,1 1,0.85',
  E: '1,0 0,0 0,1 1,1|0,0.5 0.7,0.5',
  H: '0,0 0,1|1,0 1,1|0,0.5 1,0.5',
  I: '0.5,0 0.5,1|0.2,0 0.8,0|0.2,1 0.8,1',
  L: '0,0 0,1 1,1',
  M: '0,1 0,0 0.5,0.6 1,0 1,1',
  N: '0,1 0,0 1,1 1,0',
  O: '0.5,0 0.1,0.2 0,0.5 0.1,0.8 0.5,1 0.9,0.8 1,0.5 0.9,0.2 0.5,0',
  R: '0,1 0,0 0.7,0 1,0.25 0.7,0.5 0,0.5|0.4,0.5 1,1',
  S: '1,0.1 0.5,0 0.05,0.2 0.2,0.45 0.8,0.55 0.95,0.8 0.5,1 0,0.9',
  T: '0,0 1,0|0.5,0 0.5,1',
  U: '0,0 0,0.7 0.3,1 0.7,1 1,0.7 1,0',
}
const CLUE_WORDS = ['RAIN', 'SALT', 'MOON', 'HORSE', 'TENT', 'LEMON', 'STORM', 'CHAIR', 'MUSIC', 'OCEAN', 'TRAIN', 'SMILE']
const SLOT = { left: 0.05, step: 0.085, width: 0.06, top: 0.25, base: 0.72 }
const glyph = (char: string, index: number): [number, number][][] => {
  const wobble = () => (Math.random() - 0.5) * 0.012
  const x0 = SLOT.left + index * SLOT.step
  return GLYPHS[char].split('|').map((stroke) => stroke.split(' ').map((pair) => {
    const [gx, gy] = pair.split(',').map(Number)
    return [x0 + gx * SLOT.width + wobble(), SLOT.top + gy * (SLOT.base - SLOT.top) + wobble()] as [number, number]
  }))
}
const clueWords = new Map<string, { word: string; written: number }>()

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
const leading = (votes: { choice: string }[]) => {
  const counts = new Map<string, number>()
  for (const vote of votes) counts.set(vote.choice, (counts.get(vote.choice) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const stalls = new Map<string, number>()
const looks = new Map<string, number>()
const FORCE_AFTER_TICKS = 8
const PEEK_LOOK_TICKS = 5
const GUESS_AFTER_CLUES = 4
const GUESS_WAIT_TICKS = 20

const guessRows = new Set<string>()
const typedOn = new Map<string, number>()
const secretWord = () => {
  for (const bot of bots.values()) {
    const frame = bot.conn.frame()
    if (frame?.role === 'player' && frame.id === 'ink' && frame.secret) return frame.secret.toUpperCase()
  }
  return null
}

const humanWaits = new Map<string, { ticks: number; letters: number }>()
const taken = new Set<string>()

const humanGuess = (team: string) => [...bots.values()].some((bot) => {
  const frame = bot.conn.frame()
  if (!bot.borrowed || frame?.role !== 'player' || frame.id !== 'ink') return false
  return frame.me.team === team && frame.me.role === 'guesser'
})
function waitingOnPerson(key: string, team: string, letters: number): boolean {
  if (!humanGuess(team) || taken.has(key)) return false
  const seen = humanWaits.get(key) ?? { ticks: 0, letters: -1 }
  const next = letters === seen.letters ? { ticks: seen.ticks + 1, letters } : { ticks: 0, letters }
  humanWaits.set(key, next)
  if (next.ticks < GUESS_WAIT_TICKS) return true
  taken.add(key)
  console.log(`No letters from the borrowed ${team} phone; the bots take the guess.`)
  return false
}

let toldRoles = false
let toldSecret = ''
const who = (playerId: string) => {
  const bot = bots.get(playerId)
  return `${bot?.name ?? playerId}${bot?.borrowed ? ' (your phone)' : ''}`
}
function announce(roster: Record<string, { writer: string; guessers: string[] }>) {
  if (!toldRoles) {
    toldRoles = true
    for (const team of ['sun', 'moon']) {
      console.log(`${team === 'sun' ? 'Sun' : 'Moon'}: ${who(roster[team].writer)} writes · ${roster[team].guessers.map(who).join(', ')} guess`)
    }
  }
  const secret = secretWord()
  if (secret && secret !== toldSecret) {
    toldSecret = secret
    console.log(`Secret word: ${secret}`)
  }
}

while (host.state()?.minigame?.phase === 'playing') {
  await sleep(TICK_MS)
  const forcedThisTick = new Set<string>()
  for (const [id, bot] of bots) {
    const frame = bot.conn.frame()
    if (frame?.role !== 'player' || frame.id !== 'ink' || frame.matchId !== matchId) continue
    const send = (input: { kind: string } & Record<string, unknown>) =>
      bot.conn.send({ t: 'minigameInput', matchId, seq: bot.seq++, input: { ...input, at: bot.conn.now() } as InkInput })
    const tap = async (target: string) => {
      const x = 0.15 + Math.random() * 0.7
      const y = 0.2 + Math.random() * 0.6
      const jitter = (n: number) => Math.min(1, Math.max(0, n + (Math.random() - 0.5) * 0.08))
      for (let i = 1 + Math.floor(Math.random() * 3); i > 0; i--) {
        bot.conn.send({ t: 'minigameTouch', matchId, target, x: jitter(x), y: jitter(y) })
        await sleep(80 + Math.random() * 100)
      }
    }
    announce(frame.roster)
    const s = frame.step
    const ours = frame.me.team === frame.turn
    const writer = frame.me.role === 'writer'
    const pad = frame.pad
    const writeNext = async (key: string): Promise<boolean> => {
      const clue = clueWords.get(key) ?? { word: pick(CLUE_WORDS), written: 0 }
      clueWords.set(key, clue)
      if (clue.written >= clue.word.length) return false
      for (const points of glyph(clue.word[clue.written], clue.written)) {
        send({ kind: 'stroke', points })
        await sleep(60)
      }
      clue.written++
      return true
    }

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
      if (!await writeNext(`${s.team}:${s.row}`)) send({ kind: 'stroke', points: [[0.92, 0.3], [0.92, 0.7]] })
      await sleep(200)
      send({ kind: 'done' })
    } else if (s.at === 'choose' && ours && !writer) {
      const clues = pad?.[frame.turn].filter((row) => row.kind === 'clue').length ?? 0
      const ready = clues >= GUESS_AFTER_CLUES
      const options = ready ? ['ask', 'guess'] : ['ask', ...(s.canRedraw ? ['redraw'] : [])]
      castVote(options, ready ? 'guess' : 'ask', (choice) => [`vote:${choice}`])
    } else if (s.at === 'offer' && ours && !writer) {
      const ids = frame.hand.map((card) => card.id)
      const pairs = [[ids[0], ids[1]], [ids[0], ids[2]], [ids[1], ids[2]]].map((pair) => pair.sort((a, b) => a - b).join(','))
      castVote(pairs, pairs[0], (choice) => choice.split(',').map((card) => `card:${card}`))
    } else if (s.at === 'keep' && ours && writer) send({ kind: 'keep', prompt: pick(frame.offered).id })
    else if (s.at === 'clue' && ours && writer) {
      if (s.stopped) send({ kind: 'done' })
      else if (!await writeNext(`${frame.turn}:${frame.row}`)) send({ kind: 'endClue' })
    } else if (s.at === 'clue' && ours && !writer) {
      if ((pad?.[frame.turn][frame.row].strokes.length ?? 0) >= 5 && Math.random() < 0.3) send({ kind: 'stop' })
    } else if (s.at === 'guess' && ours && !writer && frame.roster[frame.turn].guessers[0] === id) {
      const key = `${frame.turn}:${frame.row}`
      const secret = secretWord()
      const letters = pad?.[frame.turn][frame.row].letters.length ?? 0
      if (secret && !waitingOnPerson(key, frame.turn, letters)) {
        guessRows.add(key)
        const attempt = [...guessRows].filter((row) => row.startsWith(`${frame.turn}:`)).length
        const typed = Math.max(letters, typedOn.get(key) ?? 0)
        const want = secret[typed]
        const bluff = typed >= Math.ceil(secret.length / 2) && attempt < 2
        typedOn.set(key, typed + 1)
        send({ kind: 'letter', value: bluff ? (want === 'Z' ? 'Q' : 'Z') : want })
      }
    }
  }
}
console.log('Game over:', JSON.stringify(host.state()?.minigame?.results))
await sleep(3_000)
stop()
