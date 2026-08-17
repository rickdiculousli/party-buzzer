/**
 * The fuzzy answer matcher. Token-set plus bounded edit distance: a variant is
 * satisfied when every one of its content tokens has a transcript token within
 * reach, and anything else the player said is ignored.
 *
 * ponytail: this is a heuristic, not semantics. Genuinely equivalent phrasings
 * that STT renders far apart ("twenty" heard as "twenty-eight") will miss, and
 * the host's undo is the documented repair path. If misses pile up on real
 * audio, the upgrade is phonetic keys (metaphone) per token, in this one file.
 */

/** Lowercase, punctuation to spaces, articles dropped. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t !== '' && t !== 'a' && t !== 'an' && t !== 'the')
}

/** Levenshtein. Tokens are a handful of characters; the full matrix is fine. */
function edits(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/** Short tokens forgive one edit, longer ones two — a long word has more to mangle. */
const within = (a: string, b: string) => edits(a, b) <= (Math.max(a.length, b.length) <= 5 ? 1 : 2)

export function matchAnswer(transcript: string, answers: string[]): boolean {
  const heard = tokens(transcript)
  if (heard.length === 0) return false
  return answers.some((variant) => {
    const want = tokens(variant)
    // A variant that is all articles ("The") has nothing to hold against the
    // transcript; it must not match everything.
    if (want.length === 0) return false
    // STT may split one word in two ("Paris" -> "pair us"), so a wanted token
    // also counts when it is within reach of two adjacent heard tokens joined.
    return want.every((w) =>
      heard.some((h, i) => within(w, h) || (i + 1 < heard.length && within(w, h + heard[i + 1]))),
    )
  })
}
