import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { startServer } from './index.ts'
import type { ActionResult, ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

export const REVEAL = 120
export const COLLECT = 400
export const SETTLE = COLLECT + 150
const WAIT_MS = 5_000

export class FakeClient {
  ws!: WebSocket
  playerId = ''
  states: State[] = []
  results: Extract<ServerMsg, { t: 'actionResult' }>[] = []
  minigameFrames: Extract<ServerMsg, { t: 'minigameFrame' }>[] = []
  minigameAcks: Extract<ServerMsg, { t: 'minigameAck' }>[] = []
  offset = 0
  private pongs = 0
  private waiters = new Set<() => void>()
  private url: string
  private role: Role
  private lagMs: number

  constructor(url: string, role: Role, lagMs = 0) {
    this.url = url
    this.role = role
    this.lagMs = lagMs
  }

  async open(name?: string, playerId?: string): Promise<void> {
    this.ws = new WebSocket(`${this.url.replace('http', 'ws')}/ws`)
    await new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('socket failed'))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg
      if (msg.t === 'state') this.states.push(msg.state)
      else if (msg.t === 'actionResult') this.results.push(msg)
      else if (msg.t === 'minigameFrame') this.minigameFrames.push(msg)
      else if (msg.t === 'minigameAck') this.minigameAcks.push(msg)
      else if (msg.t === 'welcome') this.playerId = msg.playerId
      else if (msg.t === 'pong') {
        this.offset = msg.serverTime - (msg.t0 + performance.now()) / 2
        this.pongs++
      }
      for (const check of this.waiters) check()
    }
    const seen = this.states.length
    this.send({ t: 'hello', role: this.role, name, playerId })
    await this.until(() => this.states.length > seen, `${this.role} ${name ?? ''} joined`)
  }

  until(ready: (last: State) => boolean, what: string, timeoutMs = WAIT_MS): Promise<State> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!this.states.length || !ready(this.last)) return
        done()
        resolve(this.last)
      }
      const timer = setTimeout(() => {
        done()
        reject(new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`))
      }, timeoutMs)
      const done = () => {
        clearTimeout(timer)
        this.waiters.delete(check)
      }
      this.waiters.add(check)
      check()
    })
  }

  async request(msg: ClientMsg): Promise<ActionResult> {
    const seen = this.results.length
    this.send(msg)
    await this.until(() => this.results.length > seen, `the result of ${JSON.stringify(msg)}`)
    return this.results[seen].result
  }

  async flush(): Promise<void> {
    const seen = this.pongs
    this.ws.send(JSON.stringify({ t: 'ping', t0: performance.now() }))
    await this.until(() => this.pongs > seen, 'a pong')
  }

  async untilOpen(): Promise<void> {
    const { armedAt } = this.last.round
    assert.ok(armedAt > 0, 'the round is armed')
    while (Date.now() < armedAt) await sleep(armedAt - Date.now())
  }

  send(msg: ClientMsg): void {
    const fire = () => this.ws.send(JSON.stringify(msg))
    if (this.lagMs) setTimeout(fire, this.lagMs)
    else fire()
  }

  async sync(): Promise<void> {
    for (let i = 0; i < 5; i++) await this.flush()
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
    transcribe: null,
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
