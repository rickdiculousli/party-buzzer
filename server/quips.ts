/**
 * The host's asides after a verdict, a pool per verdict. Each line is its own
 * take, played whole: a laugh or a groan before the first word is part of the
 * line, and editing one line re-renders only that line.
 *
 * Every verdict gets a line. About half get a quip, which never repeats the
 * line just said and keeps the sincere lines rare so a straight reaction still
 * lands as one. The rest get a plain line ("Correct.", "No."), taken in
 * rotation so none comes round again until the others have.
 *
 * The pools file, hand-authored:
 *
 *   # correct
 *   [sarcastic] Wow. You read a book once.
 *   ★ [impressed] Well, shit. That was actually good.
 *   # plain correct
 *   Correct.
 *
 * `# correct`, `# wrong` and `# nobody` open a quip pool, `# plain correct`
 * and so on its plain lines; `★` (or `*`) marks a sincere quip.
 */
export type Verdict = 'correct' | 'wrong' | 'nobody'
export type Line = { text: string; sincere: boolean }
export type Pools = Record<Verdict, Line[]>

export function parsePools(text: string): { pools: Pools; plain: Pools } {
  const pools: Pools = { correct: [], wrong: [], nobody: [] }
  const plain: Pools = { correct: [], wrong: [], nobody: [] }
  let at: Line[] | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      // A pool heading, or a comment — which also ends the pool above it.
      const name = line.slice(1).trim().toLowerCase()
      const [set, key] = name.startsWith('plain ') ? [plain, name.slice(6).trim()] : [pools, name]
      at = Object.hasOwn(set, key) ? set[key as Verdict] : undefined
      continue
    }
    if (!line || !at) continue
    const sincere = /^[★*]\s*/.test(line)
    at.push({ text: line.replace(/^[★*]\s*/, ''), sincere })
  }
  return { pools, plain }
}

/**
 * ponytail: fixed odds — one verdict in two quips, sincere lines a quarter as
 * likely. Knobs on the host screen if a room wants more or less of it.
 */
const CHANCE = 1 / 2
const SINCERE_WEIGHT = 0.25

export class Picker {
  private lastLine: Partial<Record<Verdict, number>> = {}
  private turn: Partial<Record<Verdict, number>> = {}
  private rand: () => number
  constructor(rand: () => number = Math.random) {
    this.rand = rand
  }

  /** What to say for this verdict: a quip, else the next plain line, else nothing. */
  pick(v: Verdict, quips: Line[], plain: Line[] = []): Line | undefined {
    if (quips.length && this.rand() < CHANCE) {
      const open = quips.map((_, i) => i).filter((i) => quips.length === 1 || i !== this.lastLine[v])
      const weight = (i: number) => (quips[i].sincere ? SINCERE_WEIGHT : 1)
      let r = this.rand() * open.reduce((n, i) => n + weight(i), 0)
      const i = open.find((j) => (r -= weight(j)) < 0) ?? open[open.length - 1]
      this.lastLine[v] = i
      return quips[i]
    }
    if (!plain.length) return undefined
    const t = this.turn[v] ?? 0
    this.turn[v] = t + 1
    return plain[t % plain.length]
  }
}
