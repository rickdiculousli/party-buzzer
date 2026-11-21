import { useEffect, useRef, useState } from 'preact/hooks'
import { play, tune, unlock } from './sound.ts'
import { chunks } from './ui.ts'

const partsOf = (transcript: string) => chunks(transcript || 'no answer')

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
  tail?: string
  prefix: string
  onSettled?: () => void
  instant?: boolean
}) {
  const parts = partsOf(transcript)
  const [shown, setShown] = useState(instant ? parts.length : 0)
  const [settled, setSettled] = useState(instant)
  const line = useRef<HTMLParagraphElement>(null)
  const fire = useRef(onSettled)
  fire.current = onSettled

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
  }, [transcript, instant])

  return (
    <p ref={line} class={`${prefix}__spoken ${settled ? (hit ? 'is-hit' : 'is-miss') : ''}`}>
      “{parts.slice(0, shown).join(' ')}
      {shown >= parts.length && '”'}
      {shown >= parts.length && tail}
    </p>
  )
}
