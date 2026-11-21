import { setTimeout as sleep } from 'node:timers/promises'
import type { ClientMsg, MinigameFrame, ServerMsg, State } from '../shared/protocol.ts'

export const URLS = [
  'https://127-0-0-1.local-ip.sh:8080',
  'https://127-0-0-1.my.local-ip.co:8080',
  'http://localhost:8080',
]

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
    }
  }
  return tries[0]
}

export type Conn = {
  send: (msg: ClientMsg) => void
  state: () => State | null
  now: () => number
  playerId: string
  waitFor: (pred: (s: State) => boolean, timeoutMs?: number) => Promise<State>
  close: () => void
  frame: () => MinigameFrame | null
}

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
      if (
        frame.id === 'ink' && (frame.role === 'board' || frame.role === 'player') && !frame.pad &&
        prev?.id === 'ink' && (prev.role === 'board' || prev.role === 'player') && prev.matchId === frame.matchId
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
