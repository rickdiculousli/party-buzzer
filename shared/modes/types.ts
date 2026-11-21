import type { ModeStatus, OptionSpec, PlayerId, State } from '../protocol.ts'

export type ItemGrant = { playerId: PlayerId } & ({ itemId: string } | { random: true })

export type ModeContext<Options = Record<string, unknown>, Memory = unknown> =
  Pick<State, 'players' | 'teams' | 'grouping' | 'scores' | 'round'> & {
    game: { id: string; options: Options; moduleState: Memory }
  }

export type ModeOption<Options> = {
  [Key in keyof Options & string]: { key: Key } & (
    Options[Key] extends number ? Extract<OptionSpec, { kind: 'int' }> :
    Options[Key] extends boolean ? Extract<OptionSpec, { kind: 'bool' }> :
    Options[Key] extends string ? Extract<OptionSpec, { kind: 'choice' }> : OptionSpec
  )
}[keyof Options & string]

export type GameModule<Options = Record<string, unknown>, Memory = unknown> = {
  id: string
  name: string
  scoreless?: boolean
  options: ModeOption<Options>[]
  init(options: Options): Memory
  canBuzz?(state: ModeContext<Options, Memory>, playerId: PlayerId): string | null
  onCorrect?(state: ModeContext<Options, Memory>): void
  onWrong?(state: ModeContext<Options, Memory>, neg: number): void
  onArm?(state: ModeContext<Options, Memory>): void
  onFragmentEnd?(state: ModeContext<Options, Memory>, completed: number, at: number): boolean
  hostStatus?(state: ModeContext<Options, Memory>): ModeStatus | undefined
  onAct?(state: ModeContext<Options, Memory>, act: string, data?: unknown): boolean
  viewModuleState?(state: ModeContext<Options, Memory>, viewer: PlayerId | 'host' | 'board'): unknown
  grants?(state: ModeContext<Options, Memory>): ItemGrant[]
}

export type ItemDef = {
  id: string
  name: string
  target: 'self' | 'opponent'
  usableWhen(state: State, userId: PlayerId): boolean
  apply(state: State, userId: PlayerId, targetId?: PlayerId): void
}
