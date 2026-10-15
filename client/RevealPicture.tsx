import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { revealMultiplier, revealValue } from '../shared/scoring.ts'
import type { RevealWall } from '../shared/wall.ts'
import { nextRevealStep, revealCells, revealShownAt } from './reveal.ts'

/** The canvas's long side in device pixels: sharp on a 1080p wall. */
const LONG_SIDE = 1600

/**
 * Pictures already decoded, by URL. The hero takes the middle on every buzz, so
 * the picture unmounts and comes back on the rebound; drawn from here, it is
 * up in the same frame instead of a blank beat with the question jumping.
 */
const decoded = new Map<string, HTMLImageElement>()

/**
 * The reveal-clock instant to show, re-read on each step boundary of the
 * reveal clock while the picture is sharpening. A timer aimed at the boundary,
 * not an interval started whenever: the chip must drop when the price does,
 * not up to a step later.
 */
function useShownAt(r: RevealWall, now: () => number): number | undefined {
  const [at, setAt] = useState(() => revealShownAt(r, now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      const next = revealShownAt(r, now())
      if (next !== undefined) setAt(next)
      if (!r.live) return
      // A hair past the boundary, so the read lands on the new step.
      timer = setTimeout(read, Math.max(0, nextRevealStep(r, now()) - now()) + 5)
    }
    read()
    return () => clearTimeout(timer)
  }, [r.from, r.until, r.heldAt, r.live, r.sharp])
  return at
}

/**
 * A picture reveal's image on the wall: drawn through a canvas as a mosaic,
 * 6 cells across at the start, sharpening on the reveal clock and whole at its
 * end. A press holds it; the question ending shows it sharp.
 */
export function RevealPicture({ src, reveal, now }: { src: string; reveal: RevealWall; now: () => number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState(() => decoded.get(src))
  const at = useShownAt(reveal, now)

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

  // The small canvas the image is averaged into; kept so a step allocates nothing.
  const cells = useRef<HTMLCanvasElement>()
  // Before paint, so a remount never shows an empty frame.
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

  // Sized from the first frame (3:2 until the picture says otherwise), so the
  // question under it never drops when the image decodes.
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

/**
 * What the picture is worth right now, for the stakes chip: it decays on the
 * mosaic's steps, and once a press holds the picture it reads what that press
 * is playing for, the same number the award will stamp. While a buzz still
 * pays more than the plain value it is lit (tungsten, the question's value),
 * and each drop flashes it toward tally.
 */
export function RevealStakes({ value, reveal, now }: { value: number; reveal: RevealWall; now: () => number }) {
  const at = useShownAt(reveal, now)
  const t = reveal.heldAt ?? at ?? reveal.from
  const points = revealValue(value, reveal, t)
  const lit = reveal.live && revealMultiplier(reveal, t) > 1
  const first = useRef(points)
  const dropped = points !== first.current
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
