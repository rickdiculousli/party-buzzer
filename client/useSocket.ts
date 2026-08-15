import { useEffect, useRef, useState } from 'preact/hooks'
import type { ClientMsg, Role, ServerMsg, State } from '../shared/protocol.ts'

const SAMPLES = 7
const RESYNC_MS = 30_000

/**
 * Clock sync, NTP style. `performance.now()` is monotonic, so a phone whose
 * wall clock jumps mid-game cannot corrupt the offset. We keep the median of
 * several samples after discarding the slowest round-trips, which are the ones
 * most distorted by WiFi jitter.
 */
function medianOffset(samples: { rtt: number; offset: number }[]): number {
  const best = [...samples]
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.ceil(samples.length / 2)))
    .map((s) => s.offset)
    .sort((a, b) => a - b)
  return best[Math.floor(best.length / 2)]
}

export function useSocket(role: Role) {
  const [state, setState] = useState<State | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(
    () => localStorage.getItem('playerId'),
  )
  const [connected, setConnected] = useState(false)

  const socket = useRef<WebSocket | null>(null)
  const offset = useRef(0)
  const samples = useRef<{ rtt: number; offset: number }[]>([])

  const send = (msg: ClientMsg) => {
    const s = socket.current
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg))
  }

  useEffect(() => {
    let closed = false
    let retry = 500
    let resync: ReturnType<typeof setInterval> | undefined

    const ping = () => {
      samples.current = []
      for (let i = 0; i < SAMPLES; i++) {
        setTimeout(() => send({ t: 'ping', t0: performance.now() }), i * 30)
      }
    }

    const connect = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/ws`)
      socket.current = ws

      ws.onopen = () => {
        retry = 500
        setConnected(true)
        send({
          t: 'hello',
          role,
          playerId: localStorage.getItem('playerId') ?? undefined,
          name: localStorage.getItem('playerName') ?? undefined,
        })
        ping()
        resync = setInterval(ping, RESYNC_MS)
      }

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMsg
        if (msg.t === 'state') setState(msg.state)
        else if (msg.t === 'welcome') {
          localStorage.setItem('playerId', msg.playerId)
          setPlayerId(msg.playerId)
        } else if (msg.t === 'pong') {
          const t1 = performance.now()
          samples.current.push({
            rtt: t1 - msg.t0,
            offset: msg.serverTime - (msg.t0 + t1) / 2,
          })
          if (samples.current.length >= SAMPLES) {
            offset.current = medianOffset(samples.current)
          }
        }
      }

      const reconnect = () => {
        setConnected(false)
        clearInterval(resync)
        if (closed) return
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 5000)
      }

      ws.onclose = reconnect
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      clearInterval(resync)
      socket.current?.close()
    }
  }, [role])

  return {
    state,
    playerId,
    connected,
    now: () => performance.now() + offset.current,
    send,
  }
}
