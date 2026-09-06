import type { ModeStatus, OptionSpec, PlayerId, State } from '../protocol.ts'

/** An item drop a module declares and the framework executes. */
export type ItemGrant = { playerId: PlayerId } & ({ itemId: string } | { random: true })

/** Modes own scoring and question rules, not playback, catalogs or setlists. */
export type ModeContext<Options = Record<string, unknown>, Memory = unknown> =
  Pick<State, 'players' | 'teams' | 'grouping' | 'scores' | 'round'> & {
    game: { id: string; options: Options; moduleState: Memory }
  }

/** Schema keys and field kinds must agree with the options a mode reads. */
export type ModeOption<Options> = {
  [Key in keyof Options & string]: { key: Key } & (
    Options[Key] extends number ? Extract<OptionSpec, { kind: 'int' }> :
    Options[Key] extends boolean ? Extract<OptionSpec, { kind: 'bool' }> :
    Options[Key] extends string ? Extract<OptionSpec, { kind: 'choice' }> : OptionSpec
  )
}[keyof Options & string]

/**
 * A game mode. Every hook is optional; a module defining none is today's
 * game. There is deliberately no mid-session lifecycle (modes are fixed per
 * session), no event bus, and no per-module HostAction types — module-specific
 * host ops ride the `act` channel through `onAct`, with the role checked by
 * the hub.
 */
export type GameModule<Options = Record<string, unknown>, Memory = unknown> = {
  id: string
  name: string
  options: ModeOption<Options>[]
  init(options: Options): Memory
  /** Why this player may not buzz, or null. Runs at buzz time. */
  canBuzz?(state: ModeContext<Options, Memory>, playerId: PlayerId): string | null
  /** Scoring and `round.award` when the leader is right. Default: leader gets round.value. */
  onCorrect?(state: ModeContext<Options, Memory>): void
  /** Neg scoring and lockout when the leader is wrong. `neg` is what the host sent; 0 always means no penalty. */
  onWrong?(state: ModeContext<Options, Memory>, neg: number): void
  /** Fresh-question reset, called on `arm` only — never on a `wrong` rebound. */
  onArm?(state: ModeContext<Options, Memory>): void
  /** Cumulative completed fragments, from either playback path. True if state changed. */
  onFragmentEnd?(state: ModeContext<Options, Memory>, completed: number, at: number): boolean
  /** Host status data; the shared web surface owns its rendering. */
  hostStatus?(state: ModeContext<Options, Memory>): ModeStatus | undefined
  /** A host-scoped act. Return true if handled. */
  onAct?(state: ModeContext<Options, Memory>, act: string, data?: unknown): boolean
  /** What a viewer may see of moduleState. Absent: players see nothing, host/board see it raw. */
  viewModuleState?(state: ModeContext<Options, Memory>, viewer: PlayerId | 'host' | 'board'): unknown
  /** Item drops after a correct answer, declared as data. */
  grants?(state: ModeContext<Options, Memory>): ItemGrant[]
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
