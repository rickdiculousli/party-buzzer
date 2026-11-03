/**
 * What the judge heard, revealed the way it was said: a chunk of a word or
 * two at a time, each landing with a typewriter tap. A new transcript starts
 * the line over; a rebound's correction retypes rather than edits.
 *
 * The verdict is not part of the sentence. The line types out in the neutral
 * colour it was spoken in, holds `--verdict-hold`, and only then turns brass
 * or red — a colour arriving with the first chunk gives the answer away before
 * the room has finished reading it. `onSettled` fires on that same instant, so
 * a surface can land the award stamp and its thud there too.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { play, tune, unlock } from './sound.ts'
import { chunks } from './ui.ts'

/** The line as it types, a chunk per `--type-chunk`. */
const partsOf = (transcript: string) => chunks(transcript || 'no answer')

/**
 * How long after it arrives a line settles: every chunk, then the hold. The
 * line's own settle timer is this, and so is a phone's, which cannot mount
 * the line, so a change to the pace reaches both.
 */
export const settleMs = (transcript: string, scope?: Element) =>
  partsOf(transcript).length * tune('--type-chunk', scope) + tune('--verdict-hold', scope)

export function Spoken({
  transcript,
  hit,
  tail,
  prefix,
  onSettled,
  instant = false,
}: {
  transcript: string
  hit: boolean
  /** Rendered after the closing quote, e.g. the host's "— Ada". */
  tail?: string
  /** The surface's class prefix: `host` or `board`. */
  prefix: string
  /** Fired when the line has typed out and the hold has elapsed. */
  onSettled?: () => void
  /** Development previews render the final line without timers or sound. */
  instant?: boolean
}) {
  const parts = partsOf(transcript)
  const [shown, setShown] = useState(instant ? parts.length : 0)
  const [settled, setSettled] = useState(instant)
  const line = useRef<HTMLParagraphElement>(null)
  // Held in a ref so a re-render with a fresh closure cannot restart the typing.
  const fire = useRef(onSettled)
  fire.current = onSettled

  // The host surface has no other sound path, so nothing has unlocked the
  // context yet — borrow the first tap anywhere, the way the board does.
  useEffect(() => {
    if (instant) return
    const go = () => unlock()
    document.addEventListener('pointerdown', go, { once: true })
    return () => document.removeEventListener('pointerdown', go)
  }, [instant])

  useEffect(() => {
    if (instant) {
      setShown(parts.length)
      setSettled(true)
      return
    }
    setShown(0)
    setSettled(false)
    // Read the pace off the line itself, not the root: the harness sets its
    // dialled values on a wrapper, and a property read at the root never sees
    // them — the same reason `markGap` takes a scope.
    const scope = line.current ?? undefined
    let n = 0
    const t = setInterval(() => {
      n += 1
      play('type')
      setShown(n)
      if (n >= parts.length) clearInterval(t)
    }, tune('--type-chunk', scope))
    const after = setTimeout(() => {
      setSettled(true)
      fire.current?.()
    }, settleMs(transcript, scope))
    return () => {
      clearInterval(t)
      clearTimeout(after)
    }
    // parts derives from transcript alone; a fresh verdict retypes the line.
  }, [transcript, instant])

  return (
    <p ref={line} class={`${prefix}__spoken ${settled ? (hit ? 'is-hit' : 'is-miss') : ''}`}>
      “{parts.slice(0, shown).join(' ')}
      {shown >= parts.length && '”'}
      {shown >= parts.length && tail}
    </p>
  )
}
