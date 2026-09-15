import type { MinigameId } from '../../shared/protocol.ts'
import type { MinigameDefinition } from './definition.ts'
import { bow } from './bow/definition.ts'

export const MINIGAMES: Record<MinigameId, MinigameDefinition<any>> = { bow }
