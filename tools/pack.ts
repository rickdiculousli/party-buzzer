/**
 * Bring-your-own questions. Plain text, hand-authorable:
 *
 *   V: 200                          optional; falls back to the round value
 *   First fragment. / Second, which  ` / ` splits fragments
 *   continues the second. / Third.   bare lines join the current fragment
 *   A: The answer                   required, so the host can judge
 *
 *   Blank line separates questions.
 *
 * The reader tool owns the pack; question content never touches the server
 * beyond the fragments it reveals.
 */
export type Question = { value?: number; fragments: string[]; answer: string }
export type PackResult = { questions: Question[]; errors: string[] }

export function parsePack(text: string): PackResult {
  const questions: Question[] = []
  const errors: string[] = []
  let value: number | undefined
  let fragments: string[] = []
  let answer = ''
  let startLine = 0

  const flush = () => {
    if (value === undefined && fragments.length === 0 && !answer) return
    if (fragments.length === 0 || !answer) {
      errors.push(`line ${startLine}: a question needs at least one fragment and an A: line`)
    } else {
      questions.push({ value, fragments, answer })
    }
    value = undefined
    fragments = []
    answer = ''
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
      answer = line.slice(2).trim()
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
