import { useEffect, useState } from 'preact/hooks'
import { tankViewRotation, type TankViewRotation } from './tank-control.ts'

function screenAngle(): number {
  if (typeof screen.orientation?.angle === 'number') return screen.orientation.angle
  return (window as Window & { orientation?: number }).orientation ?? 0
}

function currentRotation(): TankViewRotation {
  return tankViewRotation(screenAngle(), window.innerWidth >= window.innerHeight)
}

/**
 * The CSS rotation that keeps a view in speaker-left landscape (the phone's
 * left edge down), following the screen as it autorotates.
 */
export function useSideways(): TankViewRotation {
  const [rotation, setRotation] = useState(currentRotation)
  useEffect(() => {
    const update = () => setRotation(currentRotation())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    screen.orientation?.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      screen.orientation?.removeEventListener('change', update)
    }
  }, [])
  return rotation
}

export const sidewaysClass = (rotation: TankViewRotation) =>
  rotation === 90 ? 'sideways sideways--cw'
    : rotation === -90 ? 'sideways sideways--ccw'
    : rotation === 180 ? 'sideways sideways--half'
    : 'sideways'
