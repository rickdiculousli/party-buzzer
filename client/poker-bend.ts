/** The shared material curve, independent of DOM or GPU representation. */
export const BEND_ANGLE = 2.5
export const BEND_ELEVATION = 0.55

export function bendAngle(distance: number, length: number) {
  const u = length > 0 ? Math.max(0, Math.min(1, distance / length)) : 0
  return BEND_ANGLE * u ** 3 * (u * (6 * u - 15) + 10)
}

/** Integrated unit tangent: q follows the crease normal, z rises above the cloth. */
export function bendArc(distance: number, length: number): { q: number; z: number } {
  if (distance <= 0 || length <= 0) return { q: -Math.max(0, distance), z: 0 }
  const s = Math.min(distance, length), step = s / 12
  let q = 0, z = 0
  for (let i = 0; i <= 12; i++) {
    const theta = bendAngle(i * step, length)
    const weight = i === 0 || i === 12 ? 1 : i % 2 ? 4 : 2
    q -= weight * Math.cos(theta)
    z += weight * Math.sin(theta)
  }
  const tail = Math.max(0, distance - length)
  return { q: q * step / 3 - tail * Math.cos(BEND_ANGLE), z: z * step / 3 + tail * Math.sin(BEND_ANGLE) }
}

/** Uploaded once. The vertex shader interpolates normalized arc positions, then scales by length. */
export const BEND_TABLE_SEGMENTS = 64
export function bendTable() {
  const out = new Float32Array((BEND_TABLE_SEGMENTS + 1) * 2)
  for (let i = 0; i <= BEND_TABLE_SEGMENTS; i++) {
    const { q, z } = bendArc(i / BEND_TABLE_SEGMENTS, 1)
    out[i * 2] = q; out[i * 2 + 1] = z
  }
  return out
}

export type BendProfile = { depth: number; length: number }
/** One profile for both resting cards, measured in the same screen coordinates as the crease. */
export function bendProfile(corners: readonly { x: number; y: number }[], crease: { x: number; y: number }, normal: { x: number; y: number }, width: number): BendProfile {
  let depth = 0
  for (const p of corners) depth = Math.max(depth, -((p.x - crease.x) * normal.x + (p.y - crease.y) * normal.y))
  return { depth, length: Math.min(width * 0.3, depth * 0.85) }
}
