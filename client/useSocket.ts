import { useEffect, useRef, useState } from 'preact/hooks'
import { ARM_DELAY_MS, BEAT_MISSES, BEAT_MS } from '../shared/protocol.ts'
import { finaleStep, finaleTiers, type FinaleStep } from '../shared/wall.ts'
import { setlistSpent } from '../shared/recap.ts'
import type { MinigameInputAck, ClientMsg, MinigameFrame, Role, ServerMsg, State } from '../shared/protocol.ts'
import { actionFeedback } from './ui.ts'
import { freshTouches, type TimedTouch } from './ink.ts'
import { emptyPractice, practiceLobbyId, prunePractice, recordPractice, type PracticeFeedback } from './arrival-feedback.ts'
import { recordReaction, type TimedReaction } from './reactions.ts'

const SAMPLES = 7
const RESYNC_MS = 30_000

export type SocketFixture = {
  state: State
  playerId?: string
  connected?: boolean
  now: number
  frame?: MinigameFrame
  practice?: PracticeFeedback
  reactions?: TimedReaction[]
}

function medianOffset(samples: { rtt: number; offset: number }[]): number {
  const best = [...samples]
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.ceil(samples.length / 2)))
    .map((s) => s.offset)
    .sort((a, b) => a - b)
  return best[Math.floor(best.length / 2)]
}

export function useSecondsLeft(until: number, now: () => number): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [until])
  return Math.max(0, Math.ceil((until - now()) / 1000))
}

export function useFinale(
  state: Pick<State, 'setlist' | 'grouping' | 'players' | 'teams' | 'scores'> | null | undefined,
  now: () => number,
  active: boolean,
): { step: FinaleStep; elapsed: number } {
  const spentAt = state && setlistSpent(state) ? state.setlist!.spentAt ?? -Infinity : undefined
  const tiers = spentAt === undefined ? [] : finaleTiers(state!)
  const [ticks, tick] = useState(0)
  const elapsed = spentAt === undefined ? 0 : now() - spentAt
  const { step, until } = finaleStep(tiers, elapsed)
  useEffect(() => {
    if (!active || spentAt === undefined || until === Infinity) return
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - (now() - spentAt)))
    return () => clearTimeout(t)
  }, [active, spentAt, until, ticks])
  return { step, elapsed }
}

export function useOpen(
  round: State['round'] | undefined,
  now: () => number,
  onOpen?: () => void,
  active = true,
): { open: boolean } {
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const armedAt = round?.armedAt ?? 0
  const attemptId = round?.attemptId ?? ''
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
    const wait = Math.min(ARM_DELAY_MS, Math.max(0, armedAt - now()))
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
  const [practice, setPractice] = useState<PracticeFeedback>(() => fixture?.practice ?? emptyPractice())
  const lobbyId = useRef<string | undefined>(undefined)
  const [reactions, setReactions] = useState<TimedReaction[]>(() => fixture?.reactions ?? [])
  const questionId = useRef<string | undefined>(undefined)

  const socket = useRef<WebSocket | null>(null)
  const offset = useRef(Date.now() - performance.now())
  const samples = useRef<{ rtt: number; offset: number }[]>([])

  const send = (msg: ClientMsg): boolean => {
    if (fixture) return false
    if (msg.t === 'host' || msg.t === 'act') setActionMessage(null)
    const s = socket.current
    if (!s || s.readyState !== WebSocket.OPEN) return false
    s.send(JSON.stringify(msg))
    return true
  }

  useEffect(() => {
    if (fixture) return
    let closed = false
    let retry = 500
    let resync: ReturnType<typeof setInterval> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined

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
      let heard = performance.now()

      ws.onopen = () => {
        heard = performance.now()
        retry = 500
        setConnected(true)
        const stored = localStorage.getItem('playerId')
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
        heard = performance.now()
        const msg = JSON.parse(ev.data as string) as ServerMsg
        if (msg.t === 'state') {
          setState(msg.state)
          if (!msg.state.minigame) setMinigameFrame(null)
          lobbyId.current = practiceLobbyId(msg.state)
          questionId.current = msg.state.round.questionId
          const ids = msg.state.players.map((p) => p.id)
          setPractice((f) => prunePractice(f, lobbyId.current, ids))
        }
        else if (msg.t === 'practiceBuzz') {
          const at = performance.now()
          setPractice((f) => recordPractice(f, msg.receipt, lobbyId.current, at))
        }
        else if (msg.t === 'reaction') {
          const at = performance.now()
          setReactions((list) => recordReaction(list, msg.receipt, questionId.current, at))
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
        lobbyId.current = undefined
        setPractice(emptyPractice())
        questionId.current = undefined
        setReactions([])
        clearInterval(resync)
        clearInterval(watchdog)
        if (closed) return
        setTimeout(connect, retry)
        retry = Math.min(retry * 2, 5000)
      }

      ws.onclose = reconnect
      ws.onerror = () => ws.close()
      watchdog = setInterval(() => {
        if (performance.now() - heard < BEAT_MS * BEAT_MISSES) return
        ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null
        ws.close()
        reconnect()
      }, 1000)
    }

    connect()
    return () => {
      closed = true
      clearInterval(resync)
      clearInterval(watchdog)
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
    practice,
    reactions,
    now: () => fixture?.now ?? performance.now() + offset.current,
    send,
  }
}
