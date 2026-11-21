import { setTimeout as sleep } from 'node:timers/promises'
import { reachable } from './conn.ts'
import type { ClientMsg, ServerMsg, State } from '../shared/protocol.ts'

const URL = await reachable(process.env.URL)

const PREFIX = 'fake-'
const MAX = 99
const fid = (i: number) => `${PREFIX}${String(i + 1).padStart(2, '0')}`

const NAMES = [
  'Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo',
  'Kit', 'Lou', 'Mae', 'Ned', 'Opal', 'Paz', 'Quinn', 'Rae', 'Sol', 'Uma',
]

type Sock = {
  send: (msg: ClientMsg) => void
  state: () => State | null
  close: () => void
}

async function connect(hello: ClientMsg & { t: 'hello' }): Promise<Sock> {
  const ws = new WebSocket(`${URL.replace(/^http/, 'ws')}/ws`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error(`no server at ${URL} — is it running?`))
  })
  let state: State | null = null
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg
    if (msg.t === 'state') state = msg.state
  }
  ws.send(JSON.stringify(hello))
  return { send: (m) => ws.send(JSON.stringify(m)), state: () => state, close: () => ws.close() }
}

const fakeScore = () => (Math.floor(Math.random() * 14) - 2) * 100

async function add(n: number): Promise<void> {
  const host = await connect({ t: 'hello', role: 'host' })
  const fakes: Sock[] = []
  for (let i = 0; i < n; i++) {
    fakes.push(await connect({ t: 'hello', role: 'player', name: NAMES[i % NAMES.length], playerId: fid(i) }))
  }
  await sleep(200)
  for (let i = 0; i < n; i++) {
    host.send({ t: 'host', action: { a: 'setScore', key: fid(i), score: fakeScore() } })
  }
  await sleep(200)
  for (const s of [host, ...fakes]) s.close()
  console.log(`${n} fakes in play (${fid(0)}–${fid(n - 1)}). Remove with: node tools/fakes.ts remove`)
}

async function remove(): Promise<void> {
  const host = await connect({ t: 'hello', role: 'host' })
  for (let i = 0; i < 20 && !host.state(); i++) await sleep(50)
  const victims = host.state()?.players.filter((p) => p.id.startsWith(PREFIX)) ?? []
  for (const p of victims) host.send({ t: 'host', action: { a: 'kick', playerId: p.id } })
  await sleep(200)
  host.close()
  console.log(victims.length ? `removed ${victims.length} fakes` : 'no fakes found')
}

const cmd = process.argv[2]
if (cmd === 'add') {
  const n = Math.min(Number(process.argv[3] ?? 8), MAX)
  await add(n)
} else if (cmd === 'remove') {
  await remove()
} else {
  console.log('usage: node tools/fakes.ts add [n] | remove')
  process.exit(1)
}
