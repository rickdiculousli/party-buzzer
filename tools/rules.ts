/**
 * Invariants over a trace. A rule is a predicate over the whole frame list;
 * the factories build the common shapes, and a rule that outgrows them drops
 * to the core shape — there is no parser and no ceiling.
 */
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

/** Run every rule; return every violation, not the first. */
export function check(frames: Frame[], rules: Rule[], ctx: Ctx): Violation[] {
  return rules.flatMap((r) => r.check(frames, ctx))
}

const v = (rule: string, f: Frame, detail: string): Violation => ({ rule, seq: f.seq, detail })

/** At every frame where `when` holds, `must` must hold. */
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

/** Moment b never immediately follows moment a. */
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

/** Every round.phase transition is an edge in the graph. */
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

/** From a causeA frame to the next causeB frame, at least ms elapse. */
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
          lastA = undefined // one violation per window, not one per causeB
        }
      }
      return out
    },
  }
}

/** True when any scores.* leaf moved between the two frames. */
export function scoresMoved(prev: Frame, f: Frame): boolean {
  return diffStates(prev.state, f.state).some((c) => c.path.startsWith('scores.'))
}
