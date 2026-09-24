/**
 * The host's asides after a verdict. A pool per verdict, each rendered as one
 * take and cut into its lines by where they are spoken, so a pool costs one
 * generation however many lines it holds.
 *
 * Sparse on purpose: a quip on every verdict is a bit that dies by the third
 * question. The picker skips most verdicts, never quips twice running, never
 * repeats the line it just said, and keeps the sincere lines rare so a straight
 * reaction still lands as one.
 *
 * The pools file, hand-authored:
 *
 *   # correct
 *   [sarcastic] Wow. You read a book once.
 *   ★ [impressed] Well, shit. That was actually good.
 *
 * `# correct`, `# wrong` and `# nobody` open a pool; `★` (or `*`) marks a
 * sincere line.
 */
export type Verdict = 'correct' | 'wrong' | 'nobody'
export type Line = { text: string; sincere: boolean }
export type Pools = Record<Verdict, Line[]>
export type Span = { startMs: number; endMs: number }

export function parsePools(text: string): Pools {
  const pools: Pools = { correct: [], wrong: [], nobody: [] }
  let at: Line[] | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      // A pool heading, or a comment — which also ends the pool above it.
      const name = line.slice(1).trim().toLowerCase()
      at = Object.hasOwn(pools, name) ? pools[name as Verdict] : undefined
      continue
    }
    if (!line || !at) continue
    const sincere = /^[★*]\s*/.test(line)
    at.push({ text: line.replace(/^[★*]\s*/, ''), sincere })
  }
  return pools
}

/** A pool as one take. A line each, so each keeps its own delivery. */
export function poolScript(lines: Line[]): string {
  return lines.map((l) => l.text).join('\n')
}

/**
 * ponytail: fixed odds — one verdict in three, sincere lines a quarter as
 * likely. Knobs on the host screen if a room wants more or less of it.
 */
const CHANCE = 1 / 3
const SINCERE_WEIGHT = 0.25

export class Picker {
  private quippedLast = false
  private lastLine: Partial<Record<Verdict, number>> = {}
  private rand: () => number
  constructor(rand: () => number = Math.random) {
    this.rand = rand
  }

  /** A quip that always plays, like a question's own `R:` line. It still counts as the last one. */
  forced(): void {
    this.quippedLast = true
  }

  /** Which line of the pool to say for this verdict, or undefined to let it pass in silence. */
  pick(v: Verdict, lines: Line[]): number | undefined {
    if (this.quippedLast || !lines.length || this.rand() >= CHANCE) {
      this.quippedLast = false
      return undefined
    }
    const open = lines.map((_, i) => i).filter((i) => lines.length === 1 || i !== this.lastLine[v])
    const weight = (i: number) => (lines[i].sincere ? SINCERE_WEIGHT : 1)
    let r = this.rand() * open.reduce((n, i) => n + weight(i), 0)
    const i = open.find((j) => (r -= weight(j)) < 0) ?? open[open.length - 1]
    this.lastLine[v] = i
    this.quippedLast = true
    return i
  }
}
