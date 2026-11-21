import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

export type Comment = { start: number; end: number; line: number; text: string }

const PRAGMA = /^(\/\/\/\s*<reference|\/[/*]\s*(@ts-(expect-error|ignore|nocheck)|@vite-ignore|#__PURE__|@jsx|\/?(anim:tunables|cue:recipes) \*\/$))/
const BASELINE = 'tools/comments.baseline.json'
const EXTENSIONS = ['ts', 'tsx', 'css', 'html', 'swift']

export const isPragma = (text: string) => PRAGMA.test(text)

const lineOf = (src: string, pos: number) => src.slice(0, pos).split('\n').length

function tsComments(file: string, src: string): Comment[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Map<number, Comment>()
  const visit = (node: ts.Node, parent: ts.Node | undefined) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    const kids = node.getChildren(sf)
    if (kids.length) return kids.forEach((k) => visit(k, node))
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) return
    const empty = node.kind === ts.SyntaxKind.CloseBraceToken && parent && ts.isJsxExpression(parent) && !parent.expression
    for (const r of [...(ts.getTrailingCommentRanges(src, node.pos) ?? []), ...(ts.getLeadingCommentRanges(src, node.pos) ?? [])]) {
      const [start, end] = empty ? [parent.getStart(sf), parent.end] : [r.pos, r.end]
      found.set(r.pos, { start, end, line: lineOf(src, r.pos), text: src.slice(r.pos, r.end) })
    }
  }
  visit(sf, undefined)
  return [...found.values()].sort((a, b) => a.start - b.start)
}

function cComments(file: string, src: string): Comment[] {
  const out: Comment[] = []
  const html = file.endsWith('.html')
  const slashes = file.endsWith('.swift')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (!html && (c === '"' || c === "'")) {
      for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) if (src[i] === '\\') i++
      continue
    }
    const open = html ? '<!--' : '/*'
    const close = html ? '-->' : '*/'
    let end = -1
    if (src.startsWith(open, i)) end = src.indexOf(close, i + open.length) + close.length
    else if (slashes && src.startsWith('//', i)) end = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i)
    if (end < close.length) continue
    out.push({ start: i, end, line: lineOf(src, i), text: src.slice(i, end) })
    i = end - 1
  }
  return out
}

export const comments = (file: string, src: string) =>
  /\.tsx?$/.test(file) ? tsComments(file, src) : cComments(file, src)

export function strip(file: string, src: string): string {
  let out = src
  for (const c of comments(file, src).filter((c) => !isPragma(c.text)).reverse()) {
    let start = c.start
    while (start > 0 && (out[start - 1] === ' ' || out[start - 1] === '\t')) start--
    out = out.slice(0, start) + '\u0000' + out.slice(c.end)
  }
  const lines = out.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('\u0000')) { kept.push(line); continue }
    const rest = line.replaceAll('\u0000', '')
    if (rest.trim()) { kept.push(rest); continue }
    const below = lines[i + 1]
    if (below !== undefined && !below.trim() && !below.includes('\u0000') && (!kept.length || !kept.at(-1)!.trim() || /[{([]$/.test(kept.at(-1)!))) i++
  }
  return kept.join('\n')
}

export function files(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', ...EXTENSIONS.map((e) => `*.${e}`)], { encoding: 'utf8' })
  return out.split('\n').filter((f) => f && !f.startsWith('node_modules/'))
}

export function counts(list = files()): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of list) {
    const n = comments(f, readFileSync(f, 'utf8')).filter((c) => !isPragma(c.text)).length
    if (n) out[f] = n
  }
  return out
}

export const readBaseline = (): Record<string, number> => JSON.parse(readFileSync(BASELINE, 'utf8'))

export function ratchet(now = counts(), base = readBaseline()): string[] {
  const problems: string[] = []
  for (const [f, n] of Object.entries(now)) {
    const allowed = base[f] ?? 0
    if (n > allowed) problems.push(`${f}: ${n} comments, baseline allows ${allowed}. Delete the new ones (decisions go in docs/adr/).`)
  }
  for (const [f, n] of Object.entries(base)) {
    if ((now[f] ?? 0) < n) problems.push(`${f}: ${now[f] ?? 0} comments, baseline still allows ${n}. Run npm run comments -- baseline.`)
  }
  return problems
}

if (import.meta.main) {
  const [cmd = 'check', ...args] = process.argv.slice(2)
  const list = args.length ? args : files()
  if (cmd === 'list') {
    for (const f of list) for (const c of comments(f, readFileSync(f, 'utf8'))) if (!isPragma(c.text)) console.log(`${f}:${c.line}\t${c.text.replace(/\n/g, '\n\t')}`)
  } else if (cmd === 'strip') {
    for (const f of list) {
      const src = readFileSync(f, 'utf8')
      const next = strip(f, src)
      if (next !== src) writeFileSync(f, next)
    }
  } else if (cmd === 'estimate') {
    let lines = 0, shed = 0, total = 0
    for (const f of list) {
      const src = readFileSync(f, 'utf8')
      total += comments(f, src).filter((c) => !isPragma(c.text)).length
      lines += src.split('\n').length
      shed += src.split('\n').length - strip(f, src).split('\n').length
    }
    console.log(`${total} comments in ${list.length} files; stripping them all sheds ${shed} of ${lines} lines (${((100 * shed) / lines).toFixed(1)}%).`)
  } else if (cmd === 'baseline') {
    writeFileSync(BASELINE, JSON.stringify(counts(), null, 2) + '\n')
  } else {
    const problems = ratchet()
    for (const p of problems) console.error(p)
    process.exit(problems.length ? 1 : 0)
  }
}
