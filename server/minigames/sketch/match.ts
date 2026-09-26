const LETTER = /[\p{L}\p{N}]/u

/** Case, accents, spaces and punctuation never decide a guess. */
export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export function isCorrect(guess: string, word: string): boolean {
  const g = normalize(guess)
  return g !== '' && g === normalize(word)
}

/** One edit away, on words long enough that "close" does not give the word away. */
export function isClose(guess: string, word: string): boolean {
  const w = normalize(word)
  return w.length >= 4 && distance(normalize(guess), w) === 1
}

/** Levenshtein distance. */
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[b.length]
}

/** The positions blanks hide and hints reveal. */
export function letterIndexes(word: string): number[] {
  return [...word].flatMap((ch, i) => LETTER.test(ch) ? [i] : [])
}

export function blanks(word: string, revealed: number[]): string {
  return [...word].map((ch, i) => LETTER.test(ch) && !revealed.includes(i) ? '_' : ch).join('')
}
