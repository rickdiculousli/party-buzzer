/**
 * One client connection over the real protocol, shared by the tools.
 *
 * Sockets, clock sync and the state cache are the same in `sim.ts` and
 * `probe.ts`; only what they do with a connection differs. The server cannot
 * tell either of them from a browser, which is the point — a tool that took a
 * shortcut through the HTTP layer would stop being evidence about the game.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import type { ClientMsg, ServerMsg, State } from '../shared/protocol.ts'

export type Conn = {
  send: (msg: ClientMsg) => void
  state: () => State | null
  /** Server time, synced the way the browser hook does it. */
  now: () => number
  playerId: string
  waitFor: (pred: (s: State) => boolean, timeoutMs?: number) => Promise<State>
  close: () => void
}

/**
 * `resumeId` resumes an existing player instead of minting one, the same way a
 * returning phone does. A tool that passes a stable id can be run over and over
 * without piling up a new copy of the same name every time.
 */
export async function connect(
  url: string,
  role: 'host' | 'player',
  name?: string,
  resumeId?: string,
): Promise<Conn> {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error(`no server at ${url} — is it running?`))
  })

  let state: State | null = null
  let offset = 0
  let best = Infinity
  let playerId = ''
  const waiters: { pred: (s: State) => boolean; resolve: (s: State) => void }[] = []

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg
    if (msg.t === 'welcome') playerId = msg.playerId
    else if (msg.t === 'pong') {
      const t1 = performance.now()
      const rtt = t1 - msg.t0
      // Keep the least-distorted sample rather than averaging in the bad ones.
      if (rtt < best) {
        best = rtt
        offset = msg.serverTime - (msg.t0 + t1) / 2
      }
    } else if (msg.t === 'state') {
      state = msg.state
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg.state)) waiters.splice(i, 1)[0].resolve(msg.state)
      }
    }
  }

  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg))
  send({ t: 'hello', role, name, playerId: resumeId })
  for (let i = 0; i < 5; i++) {
    send({ t: 'ping', t0: performance.now() })
    await sleep(15)
  }

  return {
    send,
    state: () => state,
    now: () => performance.now() + offset,
    get playerId() {
      return playerId
    },
    waitFor: (pred, timeoutMs = 5000) =>
      new Promise<State>((resolve, reject) => {
        if (state && pred(state)) return resolve(state)
        const w = { pred, resolve }
        waiters.push(w)
        setTimeout(() => {
          const i = waiters.indexOf(w)
          if (i >= 0) {
            waiters.splice(i, 1)
            reject(new Error('timed out waiting for the server'))
          }
        }, timeoutMs)
      }),
    close: () => ws.close(),
  } as Conn
}
