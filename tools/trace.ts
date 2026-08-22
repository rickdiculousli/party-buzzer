/** The read half of the trace: diff the frames, print what moved. */
import { readFileSync } from 'node:fs'
import { momentOf, type Moment } from '../shared/wall.ts'
import type { Frame } from '../server/trace.ts'
import type { State } from '../shared/protocol.ts'

export type Change = { path: string; from?: string; to?: string }

export function readTrace(path: string): Frame[] {
  const text = readFileSync(path, 'utf8').trim()
  return text ? text.split('\n').map((l) => JSON.parse(l)) : []
}

export function flatten(v: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (v === null || typeof v !== 'object') {
    if (prefix) out.set(prefix, JSON.stringify(v) ?? 'undefined')
    return out
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue
    flatten(val, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

export function diffStates(a: State, b: State): Change[] {
  const fa = flatten(a), fb = flatten(b)
  const out: Change[] = []
  for (const [p, to] of fb) {
    const from = fa.get(p)
    if (from !== to) out.push(from === undefined ? { path: p, to } : { path: p, from, to })
  }
  for (const [p, from] of fa) if (!fb.has(p)) out.push({ path: p, from })
  return out
}

/**
 * `settled` and `retired` are the board's animation clocks — the trace cannot
 * know them, so the moment shown is the pre-dwell one. Dwell-timing bugs
 * belong to the motion harness, not here.
 */
export function momentOfFrame(f: Frame): Moment {
  const armedAt = f.state.round.armedAt
  return momentOf(f.state, { open: armedAt != null && f.t >= armedAt, settled: false, retired: false })
}

const clip = (s: string) => (s.length > 40 ? s.slice(0, 39) + '…' : s)

export function timelineLine(f: Frame, prev: Frame | undefined): string {
  const head = `#${f.seq} ${prev ? `+${f.t - prev.t}ms` : '—'} ${f.cause} ${f.state.round.phase} ${momentOfFrame(f)}`
  if (!prev) return head
  const d = diffStates(prev.state, f.state)
  if (!d.length) return `${head} (no change)`
  const body = d.map((c) =>
    c.from === undefined ? `+${c.path}=${clip(c.to!)}`
    : c.to === undefined ? `-${c.path}`
    : `${c.path}: ${clip(c.from)}→${clip(c.to)}`
  ).join(', ')
  return `${head} — ${body}`
}

// CLI entry — guarded so the test can import the engine without running it.
if (process.argv[1]?.endsWith('tools/trace.ts')) {
  const frames = readTrace('trace.jsonl')
  for (const f of frames) console.log(timelineLine(f, frames[f.seq - 1]))
}
