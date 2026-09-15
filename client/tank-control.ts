import type { TankFrameWeapon } from '../shared/protocol.ts'

/** Turns between two pointer angles in radians, taking the short way across the ±π seam. */
export function wheelTurns(from: number, to: number): number {
  let delta = to - from
  if (delta > Math.PI) delta -= 2 * Math.PI
  else if (delta < -Math.PI) delta += 2 * Math.PI
  return delta / (2 * Math.PI)
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
