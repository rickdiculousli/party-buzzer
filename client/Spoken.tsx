/**
 * What the judge heard, revealed the way it was said: a chunk of a word or
 * two at a time, each landing with a typewriter tap. A new transcript starts
 * the line over; a rebound's correction retypes rather than edits.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { parseTune, play, unlock } from './sound.ts'
import { chunks } from './ui.ts'

export function Spoken({
  transcript,
  hit,
  tail,
  prefix,
}: {
  transcript: string
  hit: boolean
  /** Rendered after the closing quote, e.g. the host's "— Ada". */
  tail?: string
  /** The surface's class prefix: `host` or `board`. */
  prefix: string
}) {
  const parts = chunks(transcript || 'no answer')
  const [shown, setShown] = useState(0)
  const line = useRef<HTMLParagraphElement>(null)

  // The host surface has no other sound path, so nothing has unlocked the
  // context yet — borrow the first tap anywhere, the way the board does.
  useEffect(() => {
    const go = () => unlock()
    document.addEventListener('pointerdown', go, { once: true })
    return () => document.removeEventListener('pointerdown', go)
  }, [])

  useEffect(() => {
    setShown(0)
    // Read the pace off the line itself, not the root: the harness sets its
    // dialled values on a wrapper, and a property read at the root never sees
    // them — the same reason `markGap` takes a scope.
    const ms = parseTune(
      getComputedStyle(line.current ?? document.documentElement).getPropertyValue('--type-chunk'),
      220,
    )
    let n = 0
    const t = setInterval(() => {
      n += 1
      play('type')
      setShown(n)
      if (n >= parts.length) clearInterval(t)
    }, ms)
    return () => clearInterval(t)
    // parts derives from transcript alone; a fresh verdict retypes the line.
  }, [transcript])

  return (
    <p ref={line} class={`${prefix}__spoken ${hit ? 'is-hit' : 'is-miss'}`}>
      “{parts.slice(0, shown).join(' ')}
      {shown >= parts.length && '”'}
      {shown >= parts.length && tail}
    </p>
  )
}
