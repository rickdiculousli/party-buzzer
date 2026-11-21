export type Fold = { at: number; ms: number; kind: 'fragment' | 'clause' | 'end'; sure: boolean }

export type Joined = { text: string; fragmentAt: number[] }

export function join(fragments: string[]): Joined {
  const fragmentAt: number[] = []
  let at = 0
  for (const f of fragments) {
    fragmentAt.push(at)
    at += f.length + 1
  }
  return { text: fragments.join(' '), fragmentAt }
}

export function candidates(j: Joined): { at: number; kind: Fold['kind'] }[] {
  const out: { at: number; kind: Fold['kind'] }[] = []
  const frag = new Set(j.fragmentAt)
  for (let i = 1; i < j.text.length; i++) {
    if (frag.has(i)) {
      out.push({ at: i, kind: 'fragment' })
      continue
    }
    if (j.text[i] === ' ' && /[,;:.!?]/.test(j.text[i - 1])) {
      const at = i + 1
      if (at < j.text.length && !frag.has(at)) out.push({ at, kind: 'clause' })
    }
  }
  if (j.text.length) out.push({ at: j.text.length, kind: 'end' })
  return out.sort((a, b) => a.at - b.at)
}

export type Transcriber = (fromMs: number, toMs: number) => Promise<string[]>

export function words(text: string): { word: string; at: number }[] {
  const out: { word: string; at: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ word: m[0], at: m.index })
  return out
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const NUMBER: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90',
}

function same(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)]
  if (!x || !y) return false
  if (x === y) return true
  if ((NUMBER[x] ?? x) === (NUMBER[y] ?? y)) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 5 && long.length - short.length <= 3 && long.startsWith(short)
}

const ANCHOR = 2
const WINDOW = 6

function anchored(src: string[], i: number, heard: string[], k: number): boolean {
  if (i + ANCHOR > src.length || k + ANCHOR > heard.length) return false
  for (let a = 0; a < ANCHOR; a++) if (!same(src[i + a], heard[k + a])) return false
  return true
}

function resync(
  src: string[],
  i: number,
  heard: string[],
  k: number,
): { i: number; k: number } | null {
  let best: { i: number; k: number } | null = null
  let bestCost = Infinity
  for (let di = 0; di <= WINDOW; di++) {
    for (let dk = 0; dk <= WINDOW; dk++) {
      if (di === 0 && dk === 0) continue
      if (di + dk >= bestCost) continue
      if (anchored(src, i + di, heard, k + dk)) {
        best = { i: i + di, k: k + dk }
        bestCost = di + dk
      }
    }
  }
  return best
}

export function completed(src: string[], heard: string[]): number {
  let i = 0
  let k = 0
  while (i < src.length && k < heard.length) {
    if (same(src[i], heard[k])) {
      i++
      k++
      continue
    }
    if (k + 1 < heard.length && same(src[i], heard[k] + heard[k + 1])) {
      i++
      k += 2
      continue
    }
    if (i + 1 < src.length && same(src[i] + src[i + 1], heard[k])) {
      i += 2
      k++
      continue
    }
    if (i + 1 < src.length && k + 1 < heard.length && same(src[i + 1], heard[k + 1])) {
      i++
      k++
      continue
    }
    const to = resync(src, i, heard, k)
    if (to) {
      i = to.i
      k = to.k
      continue
    }
    break
  }
  return i
}

const EPS_MS = 50

const RUNUP_MS = 400

const RUNUP_WORDS = 3

export async function locate(
  j: Joined,
  durationMs: number,
  transcribe: Transcriber,
  epsMs = EPS_MS,
): Promise<Fold[]> {
  const src = words(j.text).map((w) => w.word)
  const done = new Array<number>(src.length + 1).fill(durationMs)
  const exact = new Array<boolean>(src.length + 1).fill(false)
  done[0] = 0
  exact[0] = true

  type Span = { loT: number; hiT: number; loK: number; hiK: number }
  let level: Span[] = [{ loT: 0, hiT: durationMs, loK: 0, hiK: src.length }]

  while (level.length) {
    const open: Span[] = []
    for (const s of level) {
      if (s.hiK <= s.loK) continue
      if (s.hiT - s.loT <= epsMs) {
        for (let k = s.loK + 1; k <= s.hiK; k++) {
          done[k] = s.hiT
          exact[k] = s.hiK - s.loK === 1
        }
        continue
      }
      open.push(s)
    }
    if (!open.length) break

    const mids = open.map((s) => Math.round((s.loT + s.hiT) / 2))
    const counts = await Promise.all(
      open.map(async (s, i) => {
        const from = Math.max(0, s.loT - RUNUP_MS)
        const heard = await transcribe(from, mids[i])
        let c = s.loK
        for (let base = Math.max(0, s.loK - RUNUP_WORDS); base <= s.loK; base++) {
          c = Math.max(c, base + completed(src.slice(base), heard))
        }
        return Math.min(s.hiK, Math.max(s.loK, c))
      }),
    )

    level = open.flatMap((s, i) => [
      { loT: s.loT, hiT: mids[i], loK: s.loK, hiK: counts[i] },
      { loT: mids[i], hiT: s.hiT, loK: counts[i], hiK: s.hiK },
    ])
  }

  for (let k = 1; k <= src.length; ) {
    let end = k
    while (end < src.length && done[end + 1] - done[k] <= epsMs) end++
    const run = end - k + 1
    if (run > 1) {
      const from = done[k - 1]
      const to = done[end]
      for (let i = 0; i < run; i++) done[k + i] = Math.round(from + ((to - from) * (i + 1)) / run)
    }
    k = end + 1
  }

  const starts = words(j.text).map((w) => w.at)
  const folds: Fold[] = []
  let k = 0
  let prevK = 0
  for (const { at, kind } of candidates(j)) {
    folds.push({ at, ms: done[prevK], kind, sure: exact[prevK] })
    while (k < starts.length && starts[k] < at) k++
    prevK = k
  }
  return folds
}
