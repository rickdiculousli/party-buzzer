import type { TankFrameWeapon } from '../shared/protocol.ts'

const radians = (degrees: number) => degrees * Math.PI / 180
const degrees = (value: number) => value * 180 / Math.PI

/** Turns between two pointer angles, taking the short way across the ±π seam. */
export function wheelTurns(from: number, to: number): number {
  let delta = to - from
  if (delta > Math.PI) delta -= 2 * Math.PI
  else if (delta < -Math.PI) delta += 2 * Math.PI
  return delta / (2 * Math.PI)
}

export type TankViewRotation = -90 | 0 | 90 | 180

/** CSS compensation that fixes the controller to speaker-left landscape. */
export function tankViewRotation(screenAngleDeg: number, viewportLandscape: boolean): TankViewRotation {
  const angle = ((screenAngleDeg % 360) + 360) % 360
  if (viewportLandscape) return angle === 270 ? 180 : 0
  return angle === 180 ? -90 : 90
}

/** The equivalent angle nearest the last rendered one, avoiding a 360° visual spin at ±180°. */
export function nearestAngleDegrees(previous: number | undefined, radiansValue: number): number {
  const next = degrees(radiansValue)
  if (previous === undefined) return next
  let delta = (next - previous) % 360
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  return previous + delta
}

/** Elapsed fraction of a reload; 1 once the weapon is ready. */
export function reloadProgress(weapon: TankFrameWeapon, now: number): number {
  if (now >= weapon.reloadUntil) return 1
  return Math.max(0, 1 - (weapon.reloadUntil - now) / weapon.reloadMs)
}

const COLS = 160
const CELL = 10

/** Solid cover as one SVG path, one rectangle per run of solid cells in a row. */
export function coverPath(cells: Uint8Array): string {
  let d = ''
  for (let row = 0; row * COLS < cells.length; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!cells[row * COLS + col]) continue
      const start = col
      while (col + 1 < COLS && cells[row * COLS + col + 1]) col++
      const width = (col - start + 1) * CELL
      d += `M${start * CELL} ${row * CELL}h${width}v${CELL}h-${width}z`
    }
  }
  return d
}
