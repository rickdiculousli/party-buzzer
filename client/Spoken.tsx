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

export function Spoken({
  transcript,
  hit,
  tail,
  prefix,
  onSettled,
}: {
  transcript: string
  hit: boolean
  /** Rendered after the closing quote, e.g. the host's "— Ada". */
  tail?: string
  /** The surface's class prefix: `host` or `board`. */
  prefix: string
  /** Fired when the line has typed out and the hold has elapsed. */
  onSettled?: () => void
}) {
  const parts = chunks(transcript || 'no answer')
  const [shown, setShown] = useState(0)
  const [settled, setSettled] = useState(false)
  const line = useRef<HTMLParagraphElement>(null)
  // Held in a ref so a re-render with a fresh closure cannot restart the typing.
  const fire = useRef(onSettled)
  fire.current = onSettled

  // The host surface has no other sound path, so nothing has unlocked the
  // context yet — borrow the first tap anywhere, the way the board does.
  useEffect(() => {
    const go = () => unlock()
    document.addEventListener('pointerdown', go, { once: true })
    return () => document.removeEventListener('pointerdown', go)
  }, [])

  useEffect(() => {
    setShown(0)
    setSettled(false)
    // Read the pace off the line itself, not the root: the harness sets its
    // dialled values on a wrapper, and a property read at the root never sees
    // them — the same reason `markGap` takes a scope.
    const scope = line.current ?? undefined
    const ms = tune('--type-chunk', scope)
    const hold = tune('--verdict-hold', scope)
    let n = 0
    let after: ReturnType<typeof setTimeout>
    const t = setInterval(() => {
      n += 1
      play('type')
      setShown(n)
      if (n < parts.length) return
      clearInterval(t)
      after = setTimeout(() => {
        setSettled(true)
        fire.current?.()
      }, hold)
    }, ms)
    return () => {
      clearInterval(t)
      clearTimeout(after)
    }
    // parts derives from transcript alone; a fresh verdict retypes the line.
  }, [transcript])

  return (
    <p ref={line} class={`${prefix}__spoken ${settled ? (hit ? 'is-hit' : 'is-miss') : ''}`}>
      “{parts.slice(0, shown).join(' ')}
      {shown >= parts.length && '”'}
      {shown >= parts.length && tail}
    </p>
  )
}
