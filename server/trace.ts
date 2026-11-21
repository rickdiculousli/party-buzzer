import { appendFileSync, writeFileSync } from 'node:fs'
import type { State } from '../shared/protocol.ts'

export type Tracer = (cause: string, state: State) => void

export type Frame = { seq: number; t: number; cause: string; state: State }

export function makeTracer(path: string): Tracer {
  writeFileSync(path, '')
  let seq = 0
  return (cause, state) => {
    const frame: Frame = { seq: seq++, t: Date.now(), cause, state: structuredClone(state) }
    appendFileSync(path, JSON.stringify(frame) + '\n')
  }
}
