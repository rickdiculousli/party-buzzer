import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Recorder } from './recorder.ts'
import { encodeWav } from './wav.ts'

const MAX_ANSWER_MS = 6000

function TalkCountdown({
  until,
  capSec,
  now,
}: {
  until: number
  capSec: number
  now: () => number
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [until])
  const left = Math.min(capSec * 1000, Math.max(0, until - now()))
  const secs = Math.ceil(left / 1000)
  return <span key={secs} class={secs <= 3 ? 'talk__count fx-ripple' : 'talk__count'}>{secs}s</span>
}

export function Talk({
  playerId,
  until,
  capSec,
  now,
  ctx,
  micOk,
}: {
  playerId: string | null
  until?: number
  capSec: number
  now: () => number
  ctx: AudioContext | null
  micOk: boolean
}) {
  const micStream = useRef<MediaStream | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const [talking, setTalking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [tooShort, setTooShort] = useState(false)
  const dragY = useRef(0)
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!micOk || !ctx) return
    let dead = false
    const rec = new Recorder()
    recorder.current = rec
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(async (stream) => {
      if (dead) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      micStream.current = stream
      await rec.start(stream, ctx)
      if (dead) rec.stop()
    })
    return () => {
      dead = true
      clearTimeout(capTimer.current)
      recorder.current = null
      rec.stop()
      for (const t of micStream.current?.getTracks() ?? []) t.stop()
      micStream.current = null
    }
  }, [])

  const sendAnswer = () => {
    const rec = recorder.current
    if (!rec) return
    const { samples, rate } = rec.cut()
    if (samples.length < rate * 0.25) {
      setTooShort(true)
      return
    }
    setTooShort(false)
    void fetch(`/spoken?player=${playerId}`, {
      method: 'POST',
      body: encodeWav(samples, rate),
    })
  }

  const talkDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragY.current = e.clientY
    recorder.current?.mark()
    setTalking(true)
    setCancelling(false)
    setTooShort(false)
    clearTimeout(capTimer.current)
    capTimer.current = setTimeout(() => {
      setTalking(false)
      setCancelling(false)
      sendAnswer()
    }, MAX_ANSWER_MS)
  }

  const talkMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (talking) setCancelling(e.clientY - dragY.current > 60)
  }

  const talkUp = () => {
    if (!talking) return
    setTalking(false)
    clearTimeout(capTimer.current)
    if (cancelling) {
      setCancelling(false)
      return
    }
    sendAnswer()
  }

  const countdown = until ? <TalkCountdown until={until} capSec={capSec} now={now} /> : null

  if (!micOk) {
    return (
      <div class="buzzer is-first buzzer--say" data-review-id="phone:answer">
        Say it out loud
        <span class="buzzer__sub">{countdown ?? 'the host is judging this one'}</span>
      </div>
    )
  }

  return (
    <button
      data-review-id="phone:answer"
      class={`buzzer is-first buzzer--talk${talking ? ' is-talking' : ''}${cancelling ? ' is-cancelling' : ''}`}
      onPointerDown={talkDown}
      onPointerMove={talkMove}
      onPointerUp={talkUp}
      onPointerCancel={talkUp}
    >
      {talking
        ? (cancelling ? 'Let go to cancel' : 'Let go to send')
        : (tooShort ? 'Hold a little longer' : 'Hold to answer')}
      <span class="buzzer__sub">
        {talking && !cancelling
          ? 'drag down to cancel'
          : tooShort
            ? 'that was too short to hear'
            : countdown ?? 'answer when ready'}
      </span>
    </button>
  )
}
