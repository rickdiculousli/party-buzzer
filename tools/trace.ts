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

export type FilterOpts = { since?: number; until?: number; moment?: string; watch?: string[] }

export function filterFrames(frames: Frame[], opts: FilterOpts): Frame[] {
  return frames.filter((f, i) => {
    if (opts.since !== undefined && f.seq < opts.since) return false
    if (opts.until !== undefined && f.seq > opts.until) return false
    if (opts.moment !== undefined && momentOfFrame(f) !== opts.moment) return false
    if (opts.watch) {
      const prev = frames[i - 1]
      if (!prev) return false
      if (!diffStates(prev.state, f.state).some((c) => opts.watch!.includes(c.path))) return false
    }
    return true
  })
}

/**
 * ponytail: built from causes, not a state walk — a cause string change in
 * hub.ts silently degrades this view, and the roundLines tests are the
 * tripwire.
 */
export function roundLines(frames: Frame[]): string[] {
  const lines: string[] = []
  let cur: { value: number; order: { name: string; deltaMs: number }[]; verdicts: string[]; buzzed: boolean } | undefined
  const flush = () => {
    if (!cur) return
    const order = cur.order.map((b) => `${b.name}@${b.deltaMs}`).join(', ') || '—'
    lines.push(`round $${cur.value} — ${order} → ${cur.buzzed ? cur.verdicts.join(' then ') || 'unjudged' : 'passed'}`)
    cur = undefined
  }
  for (const f of frames) {
    if (f.cause === 'host:arm') { flush(); cur = { value: f.state.round.value, order: [], verdicts: [], buzzed: false } }
    if (!cur) continue
    if (f.cause === 'settle') { cur.buzzed = true; cur.order = f.state.round.order }
    if (f.cause === 'host:correct' || f.cause === 'host:wrong') {
      const prev = frames[f.seq - 1]
      const delta = diffStates(prev.state, f.state).find((c) => c.path.startsWith('scores.'))
      const name = f.state.round.order[0]?.name ?? '?'
      const d = delta ? +JSON.parse(delta.to!) - +JSON.parse(delta.from!) : NaN
      cur.verdicts.push(`${f.cause === 'host:correct' ? 'correct' : 'wrong'} ${name} (${isNaN(d) ? '?' : `${d >= 0 ? '+' : ''}${d}`})`)
    }
    if (f.cause === 'host:next') flush()
  }
  flush()
  return lines
}

// CLI entry — guarded so the test can import the engine without running it.
if (process.argv[1]?.endsWith('tools/trace.ts')) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? undefined : args[i + 1]
  }
  const frames = readTrace(flag('file') ?? 'trace.jsonl')
  const full = flag('full')
  if (full !== undefined) {
    console.log(JSON.stringify(frames[+full]?.state ?? null, null, 2))
    process.exit(0)
  }
  if (args.includes('--round')) {
    for (const l of roundLines(frames)) console.log(l)
    process.exit(0)
  }
  const opts: FilterOpts = {
    since: flag('since') !== undefined ? +flag('since')! : undefined,
    until: flag('until') !== undefined ? +flag('until')! : undefined,
    moment: flag('moment'),
    watch: flag('watch')?.split(','),
  }
  const shown = filterFrames(frames, opts)
  for (const f of shown) console.log(timelineLine(f, frames[f.seq - 1]))
}
