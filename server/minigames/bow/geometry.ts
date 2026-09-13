import type { Vec2 } from './types.ts'

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (v: Vec2, n: number): Vec2 => ({ x: v.x * n, y: v.y * n })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const length = (v: Vec2): number => Math.hypot(v.x, v.y)
export const normalize = (v: Vec2): Vec2 => {
  const n = length(v)
  return n === 0 ? { x: 0, y: -1 } : scale(v, 1 / n)
}

export type SegmentPoint = { point: Vec2; t: number }
export type CircleHit = SegmentPoint & { normal: Vec2 }

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): SegmentPoint {
  const dx = b.x - a.x, dy = b.y - a.y
  const squared = dx * dx + dy * dy
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared,
  ))
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t }
}

export function segmentCircleHit(a: Vec2, b: Vec2, center: Vec2, radius: number): CircleHit | null {
  const dx = b.x - a.x, dy = b.y - a.y
  const ox = a.x - center.x, oy = a.y - center.y
  const c = ox * ox + oy * oy - radius * radius
  // Initial overlap is contact now, not the later exit from the circle.
  if (c <= 0) return { t: 0, point: { ...a }, normal: normalize({ x: ox, y: oy }) }
  const squared = dx * dx + dy * dy
  if (squared === 0) return null
  const halfB = ox * dx + oy * dy
  const discriminant = halfB * halfB - squared * c
  if (discriminant < 0) return null
  const t = (-halfB - Math.sqrt(discriminant)) / squared
  if (t < 0 || t > 1) return null
  const point = { x: a.x + t * dx, y: a.y + t * dy }
  return { t, point, normal: normalize(sub(point, center)) }
}

export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y
  const cdx = d.x - c.x, cdy = d.y - c.y
  const acx = c.x - a.x, acy = c.y - a.y
  const cross = abx * cdy - aby * cdx
  if (cross !== 0) {
    const t = (acx * cdy - acy * cdx) / cross
    const u = (acx * aby - acy * abx) / cross
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  }
  // Endpoint projections also cover parallel, collinear, and point segments.
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

// Scalar path avoids allocating temporary points for each shaft pair.
function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const squared = dx * dx + dy * dy
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared,
  ))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
