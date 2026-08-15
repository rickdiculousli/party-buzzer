import type { ComponentType } from 'preact'
import { useSocket } from '../useSocket.ts'
import { modeSurfaces } from './index.ts'

/**
 * Picks a surface by the active game mode, falling back to the default when
 * the module overrides nothing. Reads state over a passive board-role
 * socket — the switch never joins, never buzzes.
 *
 * ponytail: a phone running a mode override briefly holds two sockets (this
 * one plus the override's own). Harmless on a LAN; thread the socket down as
 * props if a real override ever ships and the extra connection starts to
 * matter.
 */
export function ModeSwitch({
  surface,
  fallback: Fallback,
}: {
  surface: 'Player' | 'Board'
  fallback: ComponentType
}) {
  const { state } = useSocket('board')
  const Override = state ? modeSurfaces[state.game.id]?.[surface] : undefined
  if (Override) return <Override />
  return <Fallback />
}
