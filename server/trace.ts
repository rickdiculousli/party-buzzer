import { appendFileSync, writeFileSync } from 'node:fs'
import type { State } from '../shared/protocol.ts'

export type Tracer = (cause: string, state: State) => void

/** One JSONL frame per state transition; `tools/trace.ts` is the reader. */
export type Frame = { seq: number; t: number; cause: string; state: State }

/**
 * A trace is one investigation, not an archive: creating the tracer truncates
 * whatever a previous boot left, and frames then append.
 * ponytail: no size cap — a full night is tens of MB; rotate by size if that
 * ever matters.
 */
export function makeTracer(path: string): Tracer {
  writeFileSync(path, '')
  let seq = 0
  return (cause, state) => {
    const frame: Frame = { seq: seq++, t: Date.now(), cause, state: structuredClone(state) }
    appendFileSync(path, JSON.stringify(frame) + '\n')
  }
}
