/**
 * Bring-your-own questions. Plain text, hand-authorable:
 *
 *   V: 200                          optional; falls back to the round value
 *   First fragment. / Second, which  ` / ` splits fragments
 *   continues the second. / Third.   bare lines join the current fragment
 *   A: The answer | an alternate      required, so the host can judge
 *
 *   Blank line separates questions.
 *
 * The server owns the pack and holds it in memory. Question content never
 * reaches `State` — only the fragments the room has already heard do, which is
 * what keeps a phone from seeing ahead.
 */
export type Question = { value?: number; fragments: string[]; answer: string; answers: string[] }
export type PackResult = { questions: Question[]; errors: string[] }

export function parsePack(text: string): PackResult {
  const questions: Question[] = []
  const errors: string[] = []
  let value: number | undefined
  let fragments: string[] = []
  let answer = ''
  let variants: string[] = []
  let startLine = 0

  const flush = () => {
    if (value === undefined && fragments.length === 0 && !answer) return
    if (fragments.length === 0 || !answer) {
      errors.push(`line ${startLine}: a question needs at least one fragment and an A: line`)
    } else {
      questions.push({ value, fragments, answer, answers: variants })
    }
    value = undefined
    fragments = []
    answer = ''
    variants = []
  }

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    const n = i + 1
    if (!line) {
      flush()
      return
    }
    if (line.startsWith('V:')) {
      const v = Number(line.slice(2).trim())
      if (!Number.isFinite(v) || fragments.length > 0 || answer) {
        errors.push(`line ${n}: bad or misplaced V: line`)
        return
      }
      value = v
      startLine = n
      return
    }
    if (line.startsWith('A:')) {
      // `A: Vermont | VT | the Green Mountain State` — alternates for the fuzzy
      // matcher; the first stays the display answer.
      variants = line.slice(2).split(' | ').map((s) => s.trim()).filter(Boolean)
      answer = variants[0] ?? ''
      return
    }
    if (fragments.length === 0) startLine = n
    const parts = line.split(' / ').map((s) => s.trim())
    if (fragments.length === 0) {
      fragments = parts
    } else {
      // The first segment continues the fragment in progress; the rest start new ones.
      fragments[fragments.length - 1] += ` ${parts[0]}`
      fragments.push(...parts.slice(1))
    }
  })
  flush()
  return { questions, errors }
}
