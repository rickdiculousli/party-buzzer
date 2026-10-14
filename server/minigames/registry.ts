import type { MinigameId } from '../../shared/protocol.ts'
import type { MinigameDefinition } from './definition.ts'
import { bow } from './bow/definition.ts'
import { tank } from './tank/definition.ts'
import { ink } from './ink/definition.ts'
import { sketch } from './sketch/definition.ts'
import { poker } from './poker/definition.ts'
import { tug } from './tug/definition.ts'

export const MINIGAMES: Record<MinigameId, MinigameDefinition<any>> = { bow, tank, ink, sketch, poker, tug }
