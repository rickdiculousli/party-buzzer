import { useEffect, useRef, useState } from 'preact/hooks'
import { revealValue } from '../shared/scoring.ts'
import type { RevealWall } from '../shared/wall.ts'
import { REVEAL_STEP_MS, revealCells, revealShownAt } from './reveal.ts'

/** The canvas's long side in device pixels: sharp on a 1080p wall, and the mosaic's "full resolution". */
const LONG_SIDE = 1600

/**
 * The reveal-clock instant to show, re-read every `REVEAL_STEP_MS` while the
 * picture is sharpening. Undefined until there is one to show.
 */
function useShownAt(r: RevealWall, now: () => number): number | undefined {
  const [at, setAt] = useState(() => revealShownAt(r, now()))
  useEffect(() => {
    const read = () => {
      const next = revealShownAt(r, now())
      if (next !== undefined) setAt(next)
    }
    read()
    if (!r.live) return
    const id = setInterval(read, REVEAL_STEP_MS)
    return () => clearInterval(id)
  }, [r.from, r.until, r.heldAt, r.live, r.sharp])
  return at
}

/**
 * A picture reveal's image on the wall: drawn through a canvas as a mosaic,
 * 6 cells across at the start, sharpening to the whole picture on the reveal
 * clock. A press holds it; the question ending shows it sharp.
 */
export function RevealPicture({ src, reveal, now }: { src: string; reveal: RevealWall; now: () => number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement>()
  const at = useShownAt(reveal, now)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = src
    return () => {
      img.onload = null
    }
  }, [src])

  // The small canvas the image is averaged into; kept so a step allocates nothing.
  const cells = useRef<HTMLCanvasElement>()
  useEffect(() => {
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
    const cw = Math.max(1, Math.round((w / LONG_SIDE) * across))
    const ch = Math.max(1, Math.round((h / LONG_SIDE) * across))
    const small = (cells.current ??= document.createElement('canvas'))
    small.width = cw
    small.height = ch
    const sctx = small.getContext('2d')
    if (!sctx) return
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(image, 0, 0, cw, ch)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, w, h)
  }, [image, at, reveal.from, reveal.until])

  return <canvas ref={canvas} class="board__image board__reveal" data-review-id="board:reveal" width={0} height={0} />
}

/**
 * What the picture is worth right now, for the stakes chip: it decays with the
 * mosaic, on the same steps, and once a press holds the picture it reads what
 * that press is playing for — the same number the award will stamp.
 */
export function RevealStakes({ value, reveal, now }: { value: number; reveal: RevealWall; now: () => number }) {
  const at = useShownAt(reveal, now)
  const points = revealValue(value, reveal, reveal.heldAt ?? at ?? reveal.from)
  return (
    <span key={points} class="chip board__stakes fx-flip" data-review-id="board:stakes">
      {points} pts
    </span>
  )
}
