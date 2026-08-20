import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { Recorder } from './recorder.ts'
import { encodeWav } from './wav.ts'

/** Plenty for a quizbowl answer; past it, send what there is. */
const MAX_ANSWER_MS = 6000

/** The judge's deadline, counted down in whole seconds on the synced clock. */
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
  // Same rule as the arm countdown: clamp to the most it can ever be, because
  // an unclamped one once read 1.7 trillion ms.
  const left = Math.min(capSec * 1000, Math.max(0, until - now()))
  return <span>{Math.ceil(left / 1000)}s</span>
}

/**
 * Push-to-talk, for the locked-in leader while the judge is listening. Mounted
 * only for the window it belongs to, so the mic's whole life is this
 * component's: it opens on mount and closes on unmount, and nothing here
 * outlives the round.
 */
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
  /** Last send was too brief to transcribe. Cleared by the next hold. */
  const [tooShort, setTooShort] = useState(false)
  const dragY = useRef(0)
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The mic opens on lock-in and closes with the window.
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
      // A stray cap timer would fire sendAnswer into the next window's recorder.
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
    // A tap is not an answer; a tenth of a second of room tone would only
    // transcribe to garbage and cost the player their neg. Say so on the button
    // rather than dropping it — a send that vanishes silently is indisting-
    // uishable from a broken mic, and the window is still open to try again.
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
    // Capture the pointer: the drag-down cancel leaves the button, and the
    // move/up events still have to land here.
    e.currentTarget.setPointerCapture(e.pointerId)
    dragY.current = e.clientY
    recorder.current?.mark()
    setTalking(true)
    setCancelling(false)
    setTooShort(false)
    clearTimeout(capTimer.current)
    capTimer.current = setTimeout(() => {
      // Six seconds is plenty for a quizbowl answer; past that, send what
      // there is rather than holding the round hostage to a stuck finger.
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
      // Drag-down cancelled; hold again to redo. That is the re-record.
      setCancelling(false)
      return
    }
    sendAnswer()
  }

  const countdown = until ? <TalkCountdown until={until} capSec={capSec} now={now} /> : null

  // No mic on this phone — denied, or the page is not on a secure origin,
  // which is every plain-http LAN address. Offering a button that cannot
  // record is worse than offering none: the player holds it, speaks, and
  // watches the window lapse into a neg with nothing to explain why.
  if (!micOk) {
    return (
      <div class="buzzer is-first buzzer--say">
        Say it out loud
        <span class="buzzer__sub">{countdown ?? 'the host is judging this one'}</span>
      </div>
    )
  }

  return (
    <button
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
