import type { OptionSpec, PlayerId, State } from '../protocol.ts'

/** An item drop a module declares and the framework executes. */
export type ItemGrant = { playerId: PlayerId; itemId: string }

/**
 * A game mode. Every hook is optional; a module defining none is today's
 * game. There is deliberately no mid-session lifecycle (modes are fixed per
 * session), no event bus, and no per-module HostAction types — module-specific
 * host ops ride the `act` channel through `onAct`, with the role checked by
 * the hub.
 */
export type GameModule = {
  id: string
  name: string
  options: OptionSpec[]
  init(options: Record<string, unknown>): unknown
  /** Why this player may not buzz, or null. Runs at buzz time. */
  canBuzz?(state: State, playerId: PlayerId): string | null
  /** Scoring and `round.award` when the leader is right. Default: leader gets round.value. */
  onCorrect?(state: State): void
  /** Neg scoring and lockout when the leader is wrong. `neg` is what the host sent; 0 always means no penalty. */
  onWrong?(state: State, neg: number): void
  /** Fresh-question reset, called on `arm` only — never on a `wrong` rebound. */
  onArm?(state: State): void
  /** A host-scoped act. Return true if handled. */
  onAct?(state: State, act: string, data?: unknown): boolean
  /** What a viewer may see of moduleState. Absent: players see nothing, host/board see it raw. */
  viewModuleState?(state: State, viewer: PlayerId | 'host' | 'board'): unknown
  /** Item drops after a correct answer, declared as data. */
  grants?(state: State): ItemGrant[]
}

/**
 * A boon/sabotage. Framework-level, so items compose with any mode and never
 * invent their own message type — firing rides the `act` channel.
 */
export type ItemDef = {
  id: string
  name: string
  target: 'self' | 'opponent'
  usableWhen(state: State, userId: PlayerId): boolean
  apply(state: State, userId: PlayerId, targetId?: PlayerId): void
}
