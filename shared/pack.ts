/**
 * Bring-your-own questions. Plain text, hand-authorable:
 *
 *   V: 200                          optional; falls back to the round value
 *   First fragment. / Second, which  ` / ` splits fragments
 *   continues the second. / Third.   bare lines join the current fragment
 *   I: images/tower.jpg              optional; a picture under packs/ for the board
 *   K: shown                         optional; on the board whole, still read aloud
 *   C: Mars | Venus | Saturn         optional; makes a multiple-choice question,
 *                                    and A: must equal one choice
 *   K: closest                       optional; every phone types a number and the
 *                                    nearest takes it; A: must be a number
 *   U: metres                        optional, closest only; the unit on the pad
 *   S: [curious] This composer...    optional; the performed read — tags,
 *                                    stress, ad-libs — spoken in place of the
 *                                    fragments by a paid voice; the board
 *                                    still shows the fragments
 *   R: [sarcastic] Oh, Vivaldi...     optional; a paid voice says it when
 *                                    the question is answered right
 *   A: The answer | an alternate      required, so the host can judge
 *
 *   Blank line separates questions.
 *
 * The server owns the pack and holds it in memory. Question content never
 * reaches `State` — only the fragments the room has already heard do, which is
 * what keeps a phone from seeing ahead.
 */
export type Question = {
  value?: number
  fragments: string[]
  answer: string
  answers: string[]
  /** Path relative to the pack directory. */
  image?: string
  /** Absent = read: revealed clause by clause as it is spoken. */
  kind?: 'shown' | 'choice' | 'closest'
  /** Closest questions only: `A:` as a number. Set exactly when `kind` is closest. */
  truth?: number
  /** Closest questions only, if the pack names one: what the number counts. */
  unit?: string
  /** Closest questions only: `A:` is 1000 or more with no comma, like a year, so no number gets one. */
  plain?: true
  /** Choice questions only, in display order. */
  choices?: string[]
  /** Index into `choices` of the right one. Set exactly when `choices` is. */
  correct?: number
  /** What a paid voice speaks instead of the fragments. Must say their words in order. */
  script?: string
  /** What a paid voice says when this question is answered right. */
  reaction?: string
}
export type PackResult = { questions: Question[]; errors: string[] }

export function parsePack(text: string): PackResult {
  const questions: Question[] = []
  const errors: string[] = []
  let value: number | undefined
  let fragments: string[] = []
  let answer = ''
  let variants: string[] = []
  let image: string | undefined
  let kind: 'shown' | 'closest' | undefined
  let unit: string | undefined
  let choices: string[] | undefined
  let kindError: string | undefined
  let script: string | undefined
  let reaction: string | undefined
  let startLine = 0

  const flush = () => {
    if (value === undefined && fragments.length === 0 && !answer && !image && !kind && !unit && !choices && !kindError && !script && !reaction) return
    if (kindError) {
      errors.push(kindError)
    } else if (fragments.length === 0 || !answer) {
      errors.push(`line ${startLine}: a question needs at least one fragment and an A: line`)
    } else if (unit !== undefined && kind !== 'closest') {
      errors.push(`line ${startLine}: a U: line belongs to a K: closest question`)
    } else if (kind === 'closest') {
      // `1,665` reads as the room would write it; the display answer keeps the pack's spelling.
      const truth = /^[\d,\s]*\.?\d+$/.test(answer) ? Number(answer.replace(/[,\s]/g, '')) : NaN
      if (choices) {
        errors.push(`line ${startLine}: a closest question has no C: line`)
      } else if (!Number.isFinite(truth)) {
        errors.push(`line ${startLine}: a closest question's A: must be a number of zero or more`)
      } else {
        const plain = truth >= 1000 && !answer.includes(',')
        questions.push({ value, fragments, answer, answers: variants, kind, truth, ...(unit && { unit }), ...(plain && { plain: true as const }), ...(image && { image }), ...(script && { script }), ...(reaction && { reaction }) })
      }
    } else if (choices) {
      const correct = choices.findIndex((c) => c.toLowerCase() === answer.toLowerCase())
      if (kind === 'shown') {
        errors.push(`line ${startLine}: a C: line makes a choice question; drop K: shown`)
      } else if (choices.length < 2 || choices.length > 6) {
        errors.push(`line ${startLine}: a choice question needs 2 to 6 choices`)
      } else if (correct < 0) {
        errors.push(`line ${startLine}: A: must equal one of the C: choices`)
      } else {
        questions.push({ value, fragments, answer, answers: variants, kind: 'choice', choices, correct, ...(image && { image }), ...(script && { script }), ...(reaction && { reaction }) })
      }
    } else {
      questions.push({ value, fragments, answer, answers: variants, ...(kind && { kind }), ...(image && { image }), ...(script && { script }), ...(reaction && { reaction }) })
    }
    value = undefined
    fragments = []
    answer = ''
    variants = []
    image = undefined
    kind = undefined
    unit = undefined
    choices = undefined
    kindError = undefined
    script = undefined
    reaction = undefined
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
    if (line.startsWith('K:')) {
      const k = line.slice(2).trim()
      if (k === 'shown' || k === 'closest') kind = k
      else if (k !== 'read') kindError = `line ${n}: K: must be read, shown or closest; a C: line makes a choice question`
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('S:')) {
      // Several S: lines are one script, so a long performance can wrap.
      script = script ? `${script} ${line.slice(2).trim()}` : line.slice(2).trim()
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('R:')) {
      reaction = line.slice(2).trim()
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('U:')) {
      unit = line.slice(2).trim()
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('C:')) {
      choices = line.slice(2).split(' | ').map((s) => s.trim()).filter(Boolean)
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('I:')) {
      const path = line.slice(2).trim()
      // Served from the pack directory, so it must stay inside it.
      if (!path || path.startsWith('/') || path.split(/[/\\]/).includes('..')) {
        errors.push(`line ${n}: an I: line needs a path inside the pack directory`)
        return
      }
      image = path
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
