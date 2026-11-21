import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { revealMultiplier, revealValue } from '../shared/scoring.ts'
import type { RevealWall } from '../shared/wall.ts'
import { REVEAL_WHOLE_GRACE_MS, nextRevealStep, revealCells, revealDrawnAt, revealShownAt } from './reveal.ts'

const LONG_SIDE = 1600

const decoded = new Map<string, HTMLImageElement>()

function useShownAt(r: RevealWall, now: () => number): number | undefined {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!r.live) return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      if (now() >= r.until) return
      timer = setTimeout(() => {
        tick((n) => n + 1)
        arm()
      }, Math.max(0, nextRevealStep(r, now()) - now()) + 5)
    }
    arm()
    return () => clearTimeout(timer)
  }, [r.from, r.until, r.heldAt, r.live, r.sharp])
  const last = useRef<number>()
  const at = revealShownAt(r, now())
  if (at !== undefined) last.current = at
  return last.current
}

export function RevealPicture({ src, reveal, now }: { src: string; reveal: RevealWall; now: () => number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState(() => decoded.get(src))
  const shown = useShownAt(reveal, now)
  const at = shown === undefined ? undefined : revealDrawnAt(reveal, shown, now())
  const [, tick] = useState(0)
  useEffect(() => {
    if (!reveal.live) return
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, reveal.until + REVEAL_WHOLE_GRACE_MS - now()) + 5)
    return () => clearTimeout(t)
  }, [reveal.until, reveal.live])

  useEffect(() => {
    if (decoded.get(src)) return setImage(decoded.get(src))
    const img = new Image()
    img.onload = () => {
      decoded.set(src, img)
      setImage(img)
    }
    img.src = src
    return () => {
      img.onload = null
    }
  }, [src])

  const cells = useRef<HTMLCanvasElement>()
  useLayoutEffect(() => {
    const c = canvas.current
    if (!c || !image || at === undefined) return
    const w0 = image.naturalWidth || LONG_SIDE
    const h0 = image.naturalHeight || LONG_SIDE
    const scale = LONG_SIDE / Math.max(w0, h0)
    const w = Math.round(w0 * scale)
    const h = Math.round(h0 * scale)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    const across = revealCells(reveal, at, LONG_SIDE)
    ctx.clearRect(0, 0, w, h)
    if (across >= LONG_SIDE) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(image, 0, 0, w, h)
      return
    }
    const cell = LONG_SIDE / across
    const cw = w / cell
    const ch = h / cell
    const small = (cells.current ??= document.createElement('canvas'))
    small.width = Math.ceil(cw)
    small.height = Math.ceil(ch)
    const ox = (small.width - cw) / 2
    const oy = (small.height - ch) / 2
    const sctx = small.getContext('2d')
    if (!sctx) return
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(image, 0, 0, small.width, small.height)
    sctx.drawImage(image, ox, oy, cw, ch)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, -ox * cell, -oy * cell, small.width * cell, small.height * cell)
  }, [image, at, reveal.from, reveal.until])

  const size = image ? { w: image.naturalWidth || LONG_SIDE, h: image.naturalHeight || LONG_SIDE } : { w: 3, h: 2 }
  return (
    <canvas
      ref={canvas}
      class="board__image board__reveal"
      data-review-id="board:reveal"
      style={{ '--ratio': size.w / size.h }}
    />
  )
}

export function RevealStakes({ value, reveal, now }: { value: number; reveal: RevealWall; now: () => number }) {
  const at = useShownAt(reveal, now)
  const t = reveal.heldAt ?? at ?? reveal.from
  const points = revealValue(value, reveal, t)
  const lit = reveal.live && revealMultiplier(reveal, t) > 1
  const prev = useRef(points)
  const flashed = useRef<number>()
  if (points < prev.current) flashed.current = points
  else if (points !== prev.current) flashed.current = undefined
  prev.current = points
  const dropped = flashed.current === points
  return (
    <span
      key={points}
      class={`chip board__stakes${lit ? ' chip--armed is-lit' : ''}${dropped ? ' fx-flash fx-flash--tint' : ''}`}
      style={{ '--fx-color': 'var(--tally)' }}
      data-review-id="board:stakes"
    >
      {points} pts
    </span>
  )
}
