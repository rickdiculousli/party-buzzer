/**
 * One client connection over the real protocol, shared by the tools.
 *
 * Sockets, clock sync and the state cache are the same in `sim.ts` and
 * `probe.ts`; only what they do with a connection differs. The server cannot
 * tell either of them from a browser, which is the point — a tool that took a
 * shortcut through the HTTP layer would stop being evidence about the game.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import type { ClientMsg, MinigameFrame, ServerMsg, State } from '../shared/protocol.ts'

/**
 * Where the tools look for a server, unless `URL=` says otherwise.
 *
 * The loopback spellings of the names the phones use: `127-0-0-1.local-ip.sh`
 * and `127-0-0-1.my.local-ip.co` resolve to 127.0.0.1 and are covered by the
 * wildcards the server may serve, so they work against https without disabling
 * verification. The server tries the same providers in the same order, and
 * serves plain http when neither works — that is what the last entry is for.
 */
export const URLS = [
  'https://127-0-0-1.local-ip.sh:8080',
  'https://127-0-0-1.my.local-ip.co:8080',
  'http://localhost:8080',
]

/**
 * The first working url: `url` if given, else the first of `URLS`. An https
 * url that does not answer — DNS down, or a certificate that no longer
 * verifies — falls through to the next, with a warning.
 */
export async function reachable(url?: string): Promise<string> {
  const tries = url ? [...new Set([url, url.replace(/^https:/, 'http:')])] : URLS
  for (const [i, u] of tries.entries()) {
    try {
      await fetch(`${u}/qr.svg`, { signal: AbortSignal.timeout(2500) })
      return u
    } catch (err) {
      const e = err as Error & { cause?: Error }
      if (u.startsWith('https:') && tries[i + 1])
        console.warn(`[conn] ${u} does not work (${e.cause?.message ?? e.message}); trying ${tries[i + 1]}`)
      // Every spelling failing means no server, which `connect` reports.
    }
  }
  return tries[0]
}

export type Conn = {
  send: (msg: ClientMsg) => void
  state: () => State | null
  /** Server time, synced the way the browser hook does it. */
  now: () => number
  playerId: string
  waitFor: (pred: (s: State) => boolean, timeoutMs?: number) => Promise<State>
  close: () => void
  /** The latest minigame frame received, whatever role this connection is. */
  frame: () => MinigameFrame | null
}

/**
 * `resumeId` resumes an existing player instead of minting one, the same way a
 * returning phone does. A tool that passes a stable id can be run over and over
 * without piling up a new copy of the same name every time.
 */
export async function connect(
  url: string,
  role: 'host' | 'player' | 'board',
  name?: string,
  resumeId?: string,
): Promise<Conn> {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error(`no server at ${url} — is it running?`))
  })

  let state: State | null = null
  let frame: MinigameFrame | null = null
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
    } else if (msg.t === 'minigameFrame') {
      const prev = frame
      frame = msg.frame
      // Ink frames carry the full pad only when it changed; later frames keep the last one.
      if (
        frame.id === 'ink' && frame.role !== 'spectator' && !frame.pad &&
        prev?.id === 'ink' && prev.role !== 'spectator' && prev.matchId === frame.matchId
      ) frame = { ...frame, pad: prev.pad }
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
    frame: () => frame,
  } as Conn
}
