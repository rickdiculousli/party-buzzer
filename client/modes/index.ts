import type { ComponentType } from 'preact'
import type { HostAction, State } from '../../shared/protocol.ts'

/**
 * A module may replace a surface wholesale. Override components are
 * self-contained: they open their own socket with the surface's role,
 * exactly like the defaults they replace. Trivia and quizbowl register
 * nothing and get the defaults.
 */
export type ModeSurfaces = {
  Player?: ComponentType
  Board?: ComponentType
  /** Replaces the schema-driven settings form on the host screen. */
  Settings?: ComponentType<{ state: State; act: (action: HostAction) => void }>
}

export const modeSurfaces: Record<string, ModeSurfaces> = {}
