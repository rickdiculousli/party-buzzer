import type { GameInfo, OptionSpec } from '../../shared/protocol.ts'
import type { GameModule } from '../../shared/modes/types.ts'
import { trivia } from './trivia.ts'
import { quizbowl } from './quizbowl.ts'
import { buzzer } from './buzzer.ts'

type RegisteredMode = Omit<GameModule, 'options'> & { options: OptionSpec[] }
const MODULES: RegisteredMode[] = [trivia, quizbowl, buzzer]

export function moduleFor(id: string): RegisteredMode {
  return MODULES.find((m) => m.id === id) ?? trivia
}

export function knownModule(id: string): boolean {
  return MODULES.some((m) => m.id === id)
}

export function catalog(): GameInfo[] {
  return MODULES.map((m) => ({ id: m.id, name: m.name, options: m.options, ...(m.scoreless && { scoreless: true }) }))
}

export function sanitizeOptions(
  specs: OptionSpec[],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const v = raw[spec.key]
    if (spec.kind === 'int') {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : spec.default
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, n))
    } else if (spec.kind === 'bool') {
      out[spec.key] = typeof v === 'boolean' ? v : spec.default
    } else {
      out[spec.key] = typeof v === 'string' && spec.choices.includes(v) ? v : spec.default
    }
  }
  return out
}
