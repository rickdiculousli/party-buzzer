export type Question = {
  value?: number
  fragments: string[]
  answer: string
  answers: string[]
  image?: string
  kind?: 'shown' | 'choice' | 'closest' | 'reveal'
  truth?: number
  unit?: string
  plain?: true
  choices?: string[]
  correct?: number
  script?: string
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
  let kind: 'shown' | 'closest' | 'reveal' | undefined
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
      const truth = /^[\d,\s]*\.?\d+$/.test(answer) ? Number(answer.replace(/[,\s]/g, '')) : NaN
      if (choices) {
        errors.push(`line ${startLine}: a closest question has no C: line`)
      } else if (!Number.isFinite(truth)) {
        errors.push(`line ${startLine}: a closest question's A: must be a number of zero or more`)
      } else {
        const plain = truth >= 1000 && !answer.includes(',')
        questions.push({ value, fragments, answer, answers: variants, kind, truth, ...(unit && { unit }), ...(plain && { plain: true as const }), ...(image && { image }), ...(script && { script }), ...(reaction && { reaction }) })
      }
    } else if (kind === 'reveal' && (choices || !image)) {
      errors.push(`line ${startLine}: ${choices ? 'a reveal question has no C: line' : 'a reveal question needs an I: line'}`)
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
      variants = line.slice(2).split(' | ').map((s) => s.trim()).filter(Boolean)
      answer = variants[0] ?? ''
      return
    }
    if (line.startsWith('K:')) {
      const k = line.slice(2).trim()
      if (k === 'shown' || k === 'closest' || k === 'reveal') kind = k
      else if (k !== 'read') kindError = `line ${n}: K: must be read, shown, closest or reveal; a C: line makes a choice question`
      if (fragments.length === 0) startLine = n
      return
    }
    if (line.startsWith('S:')) {
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
      fragments[fragments.length - 1] += ` ${parts[0]}`
      fragments.push(...parts.slice(1))
    }
  })
  flush()
  return { questions, errors }
}
