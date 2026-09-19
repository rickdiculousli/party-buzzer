import { useEffect, useRef, useState } from 'preact/hooks'
import { ARM_DELAY_MS } from '../shared/protocol.ts'
import type { MinigameInputAck, ClientMsg, MinigameFrame, Role, ServerMsg, State } from '../shared/protocol.ts'
import { actionFeedback } from './ui.ts'
import { freshTouches, type TimedTouch } from './ink.ts'

const SAMPLES = 7
const RESYNC_MS = 30_000

export type SocketFixture = {
  state: State
  playerId?: string
  connected?: boolean
  now: number
  frame?: MinigameFrame
}

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

/**
 * The buzzers open at `round.armedAt`, which the server sets a beat in the
 * future. Every surface counts down to that instant on its own synced clock,
 * so a phone whose arm packet arrived late still opens with everyone else.
 * Re-renders at the transition and fires `onOpen` there — that is the cue.
 */
export function useOpen(
  round: State['round'] | undefined,
  now: () => number,
  onOpen?: () => void,
  active = true,
): { open: boolean } {
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const armedAt = round?.armedAt ?? 0
  const attemptId = round?.attemptId ?? ''
  // Which arm we have opened for. The timer is the authority — re-reading the
  // clock here would leave us shut whenever setTimeout fires a hair early, with
  // no second render coming to correct it.
  const [openedFor, setOpenedFor] = useState('')
  const fire = useRef(onOpen)
  fire.current = onOpen

  useEffect(() => {
    if (!active) return
    if (!armed) return
    const go = () => {
      setOpenedFor(attemptId)
      fire.current?.()
    }
    // Never longer than the delay the server actually schedules. Without the
    // clamp a client whose clock is behind — including one that armed before
    // its first sync landed — waits roughly the current unix time and never opens.
    const wait = Math.min(ARM_DELAY_MS, Math.max(0, armedAt - now()))
    // Already past it: this client heard late. Open now rather than never.
    if (wait <= 0) return go()
    const id = setTimeout(go, wait)
    return () => clearTimeout(id)
  }, [armed, attemptId, armedAt, active])

  return { open: armed && openedFor === attemptId }
}

export function useSocket(role: Role, fixture?: SocketFixture) {
  const [state, setState] = useState<State | null>(fixture?.state ?? null)
  const [playerId, setPlayerId] = useState<string | null>(
    () => fixture?.playerId ?? localStorage.getItem('playerId'),
  )
  const [connected, setConnected] = useState(fixture?.connected ?? false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [minigameFrame, setMinigameFrame] = useState<MinigameFrame | null>(fixture?.frame ?? null)
  const [minigameAck, setMinigameAck] = useState<MinigameInputAck | null>(null)
  const [minigameTouches, setMinigameTouches] = useState<TimedTouch[]>([])

  const socket = useRef<WebSocket | null>(null)
  // Seeded from this device's own wall clock so `now()` is in the server's
  // domain from the first render, not only once sync lands. Sync then refines
  // it from device accuracy to millisecond accuracy.
  const offset = useRef(Date.now() - performance.now())
  const samples = useRef<{ rtt: number; offset: number }[]>([])

  const send = (msg: ClientMsg) => {
    if (fixture) return
    if (msg.t === 'host' || msg.t === 'act') setActionMessage(null)
    const s = socket.current
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(msg))
  }

  useEffect(() => {
    if (fixture) return
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
        const stored = localStorage.getItem('playerId')
        // A player we have never seen has no name yet, and saying hello would
        // mint an unnamed ghost. Their join tap sends the first hello instead.
        if (role !== 'player' || stored) {
          send({
            t: 'hello',
            role,
            playerId: stored ?? undefined,
            name: localStorage.getItem('playerName') ?? undefined,
          })
        }
        ping()
        resync = setInterval(ping, RESYNC_MS)
      }

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMsg
        if (msg.t === 'state') {
          setState(msg.state)
          if (!msg.state.minigame) setMinigameFrame(null)
        }
        else if (msg.t === 'actionResult') setActionMessage(actionFeedback(msg.action, msg.result))
        else if (msg.t === 'minigameFrame') setMinigameFrame(msg.frame)
        else if (msg.t === 'minigameAck') setMinigameAck(msg.ack)
        else if (msg.t === 'minigameTouch') {
          const at = performance.now()
          setMinigameTouches((list) => [...freshTouches(list, at), { ...msg.touch, at }])
        }
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
  }, [role, fixture])

  return {
    state,
    playerId,
    connected,
    actionMessage,
    minigameFrame,
    minigameAck,
    minigameTouches,
    now: () => fixture?.now ?? performance.now() + offset.current,
    send,
  }
}
