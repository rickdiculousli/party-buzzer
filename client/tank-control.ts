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
