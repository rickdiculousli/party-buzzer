import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { startServer } from './index.ts'
import type { ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

/** Short timers so the suite runs fast; production uses 150ms / 1s. */
export const REVEAL = 120
export const COLLECT = 400
/** Long enough for collection to close and the round to publish. */
export const SETTLE = COLLECT + 150

/** A fake participant: real socket, real JSON frames, optional injected lag. */
export class FakeClient {
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

export async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-e2e-'))
  const server = await startServer({
    port: 0,
    statePath: join(dir, 'state.json'),
    revealMs: REVEAL,
    collectMs: COLLECT,
    // No speech-to-text in tests: boot must never invoke swiftc.
    transcribe: null,
    // Nor fetch a certificate: boot must never touch the network either.
    tls: false,
    setlistDir: join(dir, 'setlists'),
  })
  try {
    await fn(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
