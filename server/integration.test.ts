import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { startServer } from './index.ts'
import { ARM_LEAD_MS } from './state.ts'
import type { ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

const WINDOW = 150

/** A fake participant: real socket, real JSON frames, optional injected lag. */
class FakeClient {
  ws!: WebSocket
  playerId = ''
  states: State[] = []
  offset = 0
  private url: string
  private role: Role
  private lagMs: number

  constructor(url: string, role: Role, lagMs = 0) {
    this.url = url
    this.role = role
    this.lagMs = lagMs
  }

  /** Pass `playerId` to rejoin as an existing player, the way a reloaded phone does. */
  async open(name?: string, playerId?: string): Promise<void> {
    this.ws = new WebSocket(`${this.url.replace('http', 'ws')}/ws`)
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('socket failed'))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      if (msg.t === 'state') this.states.push(msg.state)
      else if (msg.t === 'welcome') this.playerId = msg.playerId
      else if (msg.t === 'pong') {
        this.offset = msg.serverTime - (msg.t0 + performance.now()) / 2
      }
    }
    this.send({ t: 'hello', role: this.role, name, playerId })
    await sleep(50)
  }

  send(msg: ClientMsg): void {
    const fire = () => this.ws.send(JSON.stringify(msg))
    if (this.lagMs) setTimeout(fire, this.lagMs)
    else fire()
  }

  /** Sync the clock the same way the browser hook does. */
  async sync(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      this.ws.send(JSON.stringify({ t: 'ping', t0: performance.now() }))
      await sleep(10)
    }
  }

  get last(): State {
    return this.states[this.states.length - 1]
  }

  close(): void {
    this.ws.close()
  }
}

async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-e2e-'))
  const server = await startServer({
    port: 0,
    statePath: join(dir, 'state.json'),
    windowMs: WINDOW,
  })
  try {
    await fn(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the player who pressed first wins despite arriving last', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    // Bea is on a bad connection: her packets take 40ms longer than Amy's.
    const amy = new FakeClient(url, 'player', 0)
    const bea = new FakeClient(url, 'player', 40)
    await host.open()
    await amy.open('Amy')
    await bea.open('Bea')
    await amy.sync()
    await bea.sync()

    host.send({ t: 'host', action: { a: 'arm' } })
    await sleep(30)

    // Amy jumps the gun during the lead-in. If the pre-fire guard broke, this
    // buzz would be kept and she would take first below.
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })
    await sleep(ARM_LEAD_MS)

    // Bea physically presses 20ms before Amy.
    bea.send({ t: 'buzz', at: performance.now() + bea.offset })
    await sleep(20)
    amy.send({ t: 'buzz', at: performance.now() + amy.offset })

    await sleep(WINDOW + 250)

    const order = host.last.round.order
    assert.equal(host.last.round.phase, 'LOCKED')
    assert.deepEqual(
      order.map((b) => b.name),
      ['Bea', 'Amy'],
      'arrival order would have put Amy first; press order must win',
    )
    assert.ok(order[1].deltaMs >= 10, `expected ~20ms gap, got ${order[1].deltaMs}`)

    for (const c of [host, amy, bea]) c.close()
  })
})

test('a player reconnects with the same identity and score', async () => {
  await withServer(async (url) => {
    const host = new FakeClient(url, 'host')
    const amy = new FakeClient(url, 'player')
    await host.open()
    await amy.open('Amy')

    // A second hello on a live socket — what the page does when a returning
    // phone auto-greets and then taps to play — must not mint a second player.
    amy.send({ t: 'hello', role: 'player', name: 'Amy' })
    await sleep(50)
    assert.equal(host.last.players.length, 1, 'a re-hello must not duplicate')

    host.send({ t: 'host', action: { a: 'setScore', key: amy.playerId, score: 700 } })
    await sleep(50)
    amy.close()
    await sleep(50)

    const again = new FakeClient(url, 'player')
    await again.open(undefined, amy.playerId)
    await sleep(50)

    assert.equal(host.last.players.length, 1, 'no duplicate player on reconnect')
    assert.equal(host.last.players[0].connected, true)
    assert.equal(host.last.players[0].name, 'Amy', 'name survived the reconnect')
    assert.equal(host.last.scores[amy.playerId], 700)

    again.close()
    host.close()
  })
})
