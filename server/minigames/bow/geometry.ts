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

export type SweepHit = { t: number; normal: Vec2 }

// First contact between translating capsules. Radius is the sum of their radii.
// Relative motion compares shafts at the SAME time, avoiding swept-footprint
// false positives. Directions are fixed over the sweep (no angular dynamics).
export function sweptSegmentHit(
  a: Vec2, b: Vec2, delta: Vec2, c: Vec2, d: Vec2, otherDelta: Vec2, radius: number,
): SweepHit | null {
  const relative = sub(delta, otherDelta)
  if (segmentDistance(a, b, c, d) <= radius) {
    let separation = sub(a, closestPointOnSegment(a, c, d).point)
    let distance = length(separation)
    for (const [p, start, end, sign] of [[b, c, d, 1], [c, a, b, -1], [d, a, b, -1]] as const) {
      const candidate = scale(sub(p, closestPointOnSegment(p, start, end).point), sign)
      if (length(candidate) < distance) {
        separation = candidate
        distance = length(candidate)
      }
    }
    // Crossing interiors have no unique normal. Use the incoming motion;
    // coincident stationary shafts inherit normalize's deterministic fallback.
    return { t: 0, normal: normalize(distance > radius || distance === 0 ? scale(relative, -1) : separation) }
  }
  let first: SweepHit | null = null
  // For disjoint 2D segments, first contact involves at least one endpoint.
  for (const [p, start, end, sign] of [[a, c, d, 1], [b, c, d, 1], [c, a, b, -1], [d, a, b, -1]] as const) {
    const hit = pointCapsuleHit(p, scale(relative, sign), start, end, radius)
    if (hit && (!first || hit.t < first.t)) first = { t: hit.t, normal: scale(hit.normal, sign) }
  }
  return first
}

function pointCapsuleHit(p: Vec2, delta: Vec2, a: Vec2, b: Vec2, radius: number): SweepHit | null {
  const end = add(p, delta)
  let first: SweepHit | null = segmentCircleHit(p, end, a, radius)
  const cap = segmentCircleHit(p, end, b, radius)
  if (cap && (!first || cap.t < first.t)) first = cap
  const shaft = sub(b, a)
  const size = length(shaft)
  if (size === 0) return first
  const axis = scale(shaft, 1 / size)
  const normal = { x: -axis.y, y: axis.x }
  const startDistance = dot(sub(p, a), normal)
  const normalTravel = dot(delta, normal)
  if (normalTravel === 0) return first
  for (const sign of [-1, 1]) {
    const t = (sign * radius - startDistance) / normalTravel
    if (t < 0 || t > 1 || (first && t >= first.t)) continue
    const along = dot(sub(add(p, scale(delta, t)), a), axis)
    if (along >= 0 && along <= size) first = { t, normal: scale(normal, sign) }
  }
  return first
}
