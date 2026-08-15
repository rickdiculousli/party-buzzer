import type { GameInfo, OptionSpec } from '../../shared/protocol.ts'
import type { GameModule } from '../../shared/modes/types.ts'
import { trivia } from './trivia.ts'
import { quizbowl } from './quizbowl.ts'

const MODULES: GameModule[] = [trivia, quizbowl]

/** The module behind a game id. Unknown ids fall back to trivia, so a snapshot written by another build still boots. */
export function moduleFor(id: string): GameModule {
  return MODULES.find((m) => m.id === id) ?? trivia
}

export function knownModule(id: string): boolean {
  return MODULES.some((m) => m.id === id)
}

/** The static catalog the host's settings form is rendered from. */
export function catalog(): GameInfo[] {
  return MODULES.map((m) => ({ id: m.id, name: m.name, options: m.options }))
}

/** Fill defaults and coerce junk into range, so modules can trust their options. */
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
