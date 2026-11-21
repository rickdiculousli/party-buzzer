import { momentOfFrame, diffStates } from './trace.ts'
import type { Frame } from '../server/trace.ts'
import type { Moment } from '../shared/wall.ts'

export type Violation = { rule: string; seq: number; detail: string }
export type Window = { kind: string; cue?: string; start: number; end: number }
export type Ctx = { speech?: Window[] }
export type Rule = {
  name: string
  check(frames: Frame[], ctx: Ctx): Violation[]
}

export function check(frames: Frame[], rules: Rule[], ctx: Ctx): Violation[] {
  return rules.flatMap((r) => r.check(frames, ctx))
}

const v = (rule: string, f: Frame, detail: string): Violation => ({ rule, seq: f.seq, detail })

export function whenever(
  name: string,
  when: (prev: Frame | undefined, f: Frame) => boolean,
  must: (prev: Frame | undefined, f: Frame) => boolean,
): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        return when(prev, f) && !must(prev, f)
          ? [v(name, f, `${f.cause} at ${f.state.round.phase}`)]
          : []
      }),
  }
}

export function neverFollows(name: string, a: Moment, b: Moment): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        return prev && momentOfFrame(prev) === a && momentOfFrame(f) === b
          ? [v(name, f, `${a} -> ${b} on ${f.cause}`)]
          : []
      }),
  }
}

export function phaseGraph(name: string, graph: Record<string, string[]>): Rule {
  return {
    name,
    check: (frames) =>
      frames.flatMap((f, i) => {
        const prev = frames[i - 1]
        if (!prev) return graph[f.state.round.phase] ? [] : [v(name, f, `opens in ${f.state.round.phase}`)]
        const from = prev.state.round.phase, to = f.state.round.phase
        return from !== to && !graph[from]?.includes(to)
          ? [v(name, f, `${from} -> ${to} on ${f.cause}`)]
          : []
      }),
  }
}

export function minGap(name: string, causeA: string, causeB: string, ms: number): Rule {
  return {
    name,
    check: (frames) => {
      let lastA: Frame | undefined
      const out: Violation[] = []
      for (const f of frames) {
        if (f.cause === causeA) lastA = f
        else if (f.cause === causeB && lastA && f.t - lastA.t < ms) {
          out.push(v(name, f, `${f.t - lastA.t}ms < ${ms}ms between ${causeA} and ${causeB}`))
          lastA = undefined
        }
      }
      return out
    },
  }
}

export function scoresMoved(prev: Frame, f: Frame): boolean {
  return diffStates(prev.state, f.state).some(
    (c) => c.path.startsWith('scores.') && !(c.from === undefined && c.to === '0'),
  )
}

import { RECIPES, span } from '../client/cues.ts'

export function cueWindows(frames: Frame[]): Window[] {
  const out: Window[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const prev = frames[i - 1]
    const before = prev?.state.round.order.length ?? 0
    const after = f.state.round.order.length
    for (let j = before; j < after; j++) {
      const cue = j === 0 ? 'leader' : 'stamp'
      out.push({ kind: 'cue', cue, start: f.t, end: f.t + span(RECIPES[cue]!) })
    }
    const had = prev?.state.round.award
    const now = f.state.round.award
    if (now && (!had || JSON.stringify(had) !== JSON.stringify(now))) {
      const cue = now.points < 0 ? 'penalty' : 'award'
      out.push({ kind: 'cue', cue, start: f.t, end: f.t + span(RECIPES[cue]!) })
    }
  }
  return out
}

export function noOverlap(name: string, kindA: string, kindB: string): Rule {
  return {
    name,
    check: (frames, ctx) => {
      const all = [...cueWindows(frames), ...(ctx.speech ?? [])]
      const as = all.filter((w) => w.kind === kindA)
      const bs = all.filter((w) => w.kind === kindB)
      const out: Violation[] = []
      for (const a of as)
        for (const b of bs)
          if (a.start < b.end && b.start < a.end) {
            const f = frames.find((x) => x.t >= Math.max(a.start, b.start)) ?? frames[frames.length - 1]
            out.push({ rule: name, seq: f?.seq ?? 0, detail: `${kindA} [${a.start},${a.end}] x ${kindB}${b.cue ? `(${b.cue})` : ''} [${b.start},${b.end}]` })
          }
      return out
    },
  }
}

import { COLLECT_MS } from '../shared/protocol.ts'

export const RULES: Rule[] = [
  whenever('lock needs a leader',
    (_p, f) => f.state.round.phase === 'LOCKED',
    (_p, f) => f.state.round.order.length > 0),

  neverFollows('no lock after award', 'verdict:award', 'answer:locked'),

  phaseGraph('phase graph', {
    IDLE: ['ARMED'],
    ARMED: ['COLLECTING', 'IDLE'],
    COLLECTING: ['LOCKED', 'IDLE'],
    LOCKED: ['IDLE', 'ARMED'],
  }),

  minGap('full collect window', 'buzz', 'settle', COLLECT_MS),

  whenever('scores move only on verdicts',
    (p, f) => !!p && scoresMoved(p, f),
    (_p, f) => ['host:correct', 'host:wrong', 'host:undo'].includes(f.cause)),

  whenever('order is ordered',
    (_p, f) => f.state.round.order.length > 1,
    (_p, f) => f.state.round.order.every((b, i, o) => i === 0 || o[i - 1].deltaMs <= b.deltaMs)),

  noOverlap('voice never talks over the room', 'say', 'cue'),

  {
    name: 'voice ends at the buzz',
    check: (frames, ctx) =>
      (ctx.speech ?? []).flatMap((w) => {
        const buzz = frames.find((f) => f.cause === 'buzz' && f.t >= w.start)
        return buzz && w.end > buzz.t
          ? [{ rule: 'voice ends at the buzz', seq: buzz.seq, detail: `say ends ${w.end}, buzz at ${buzz.t}` }]
          : []
      }),
  },
]
