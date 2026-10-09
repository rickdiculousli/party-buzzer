/**
 * Hear the paid voice without starting the game.
 *
 *   npm run voice -- quizbowl-lite.txt               what's new, what's cached, how long each runs
 *   npm run voice -- quizbowl-lite.txt --go          render the new lines (spends credits)
 *   npm run voice -- quizbowl-lite.txt --play        play the performed lines: S:, R: and the quip pools
 *   npm run voice -- "[snickers] Okay. [deadpan, quick] Absolutely not." --go --play
 *   npm run voice -- quizbowl-lite.txt --html        a workbench: listen, edit, nix, note, copy feedback
 *
 * A pack's texts come from the reader itself (`textsOf`), and takes land in
 * the cache the game reads, keyed the same way. So a line rendered here is
 * already paid for when the game reaches it, and a line the game rendered
 * plays here for free. Nothing renders without `--go`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hub } from '../server/hub.ts'
import { newState } from '../server/state.ts'
import { Reader } from '../server/reader.ts'
import { parsePools } from '../server/quips.ts'
import { loadPack } from '../server/packs.ts'
import { HOUSE_VOICE, synthesize, takePath, timedFor } from '../server/eleven.ts'
import { play } from '../server/speech.ts'

const args = process.argv.slice(2)
const go = args.includes('--go')
const listen = args.includes('--play')
const html = args.includes('--html')
const target = args.find((a) => !a.startsWith('--'))
if (!target) {
  console.log('usage: npm run voice -- <pack.txt | "a line to say"> [--go] [--play]')
  process.exit(2)
}

const packDir = join(import.meta.dirname, '..', 'packs')
const cacheDir = join(packDir, '.cache')
const voice = process.env.ELEVENLABS_VOICE_ID ?? HOUSE_VOICE
const key = process.env.ELEVENLABS_API_KEY
const quips = parsePools(readFileSync(join(packDir, 'quips', 'pools.txt'), 'utf8'))

const isPack = target.endsWith('.txt')
const texts = isPack
  ? new Reader(new Hub(newState(), { packDir }), {
      packDir,
      cacheDir,
      // Only its presence matters: with an aligner a question is one utterance.
      align: async () => [],
      perform: true,
      quips,
    }).textsOf(target)
  : [target]

const short = (t: string) => (t.length > 90 ? `${t.slice(0, 87)}…` : t)
const cached = (t: string) => existsSync(takePath(cacheDir, t, voice))
const fresh = texts.filter((t) => !cached(t))
const chars = fresh.reduce((n, t) => n + t.length, 0)

if (fresh.length && go) {
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set (cd into the repo so direnv loads it)')
    process.exit(1)
  }
  for (const [i, t] of fresh.entries()) {
    process.stdout.write(`rendering ${i + 1}/${fresh.length}…\r`)
    await synthesize(cacheDir, t, voice, key).catch((e) => console.error(`\nfailed: ${short(t)}\n  ${e}`))
  }
  process.stdout.write('\n')
}

const poolLines = new Set([...Object.values(quips.pools), ...Object.values(quips.plain)].flat().map((l) => l.text))
const toPlay: string[] = []
const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`.padStart(6)

for (const t of texts) {
  const path = takePath(cacheDir, t, voice)
  const timed = existsSync(path) ? timedFor(path) : undefined
  const kind = poolLines.has(t) ? 'pool' : t.includes('[') ? 'line' : 'read'
  console.log(`${timed ? s(timed.endMs.at(-1) ?? 0) : '   new'}  ${kind}  ${short(t)}`)
  if (timed && kind !== 'read') toPlay.push(t)
}

if (fresh.length && !go) {
  console.log(`\n${fresh.length} new, ~${chars.toLocaleString()} credits. Add --go to render them.`)
}

if (html) {
  // ponytail: a static page opened from disk. Listen, edit, nix and note here;
  // "Copy feedback" turns it into text to paste back. Nothing writes the files
  // from the page.
  // Every performed line that exists, every pack: S: and R: lines, then the
  // pools. Then the drafts in draft.txt, which the game never reads.
  type Row = { id: number; kind: string; t: string; path?: string; ms?: number }
  const all: Row[] = []
  const add = (kind: string, t: string, render = true) => {
    const path = takePath(cacheDir, t, voice)
    const timed = render && existsSync(path) ? timedFor(path) : undefined
    all.push({ id: all.length + 1, kind, t, ...(timed && { path, ms: timed.endMs.at(-1) ?? 0 }) })
  }
  for (const name of readdirSync(packDir).filter((f) => f.endsWith('.txt')).sort()) {
    const questions = loadPack(packDir, name).questions
    for (const q of questions) if (q.script) add(`${name} S:`, q.script)
    for (const q of questions) if (q.reaction) add(`${name} R:`, q.reaction)
  }
  const sets = (file: string) => {
    const { pools, plain } = parsePools(readFileSync(file, 'utf8'))
    return [...Object.entries(pools).map(([v, l]) => [v, l] as const), ...Object.entries(plain).map(([v, l]) => [`plain ${v}`, l] as const)]
  }
  for (const [kind, lines] of sets(join(packDir, 'quips', 'pools.txt'))) {
    for (const l of lines) add(kind, l.text)
  }
  const draftPath = join(packDir, 'quips', 'draft.txt')
  if (existsSync(draftPath)) {
    for (const [kind, lines] of sets(draftPath)) for (const l of lines) add(`draft ${kind}`, `${l.sincere ? '★ ' : ''}${l.text}`, false)
  }
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const body = all
    .map(
      (r, i) => `${all[i - 1]?.kind === r.kind ? '' : `<tr class="h"><th colspan="7">${esc(r.kind)}</th></tr>`}<tr data-id="${r.id}" data-kind="${esc(r.kind)}" data-t="${esc(r.t)}">
<td>#${r.id}</td><td>${esc(r.kind)}</td><td>${r.ms === undefined ? '' : `${(r.ms / 1000).toFixed(1)}s`}</td>
<td>${r.path ? `<audio controls preload="none" src="file://${esc(r.path)}"></audio>` : '<i>not rendered</i>'}</td>
<td><input class="t" value="${esc(r.t)}"></td><td><input class="note" placeholder="note"></td>
<td><button onclick="this.closest('tr').classList.toggle('nixed')">nix</button></td></tr>`,
    )
    .join('\n')
  const out = join(cacheDir, 'workbench.html')
  writeFileSync(
    out,
    `<!doctype html><meta charset="utf-8"><title>voice: ${esc(target)}</title>
<style>
body{font:14px system-ui;margin:2em}td{padding:4px 8px;border-bottom:1px solid #ddd;vertical-align:middle}
input.t{width:34em}input.note{width:14em}tr.nixed td{opacity:.35;text-decoration:line-through}
th{text-align:left;padding:18px 8px 6px;font-size:16px}#bar{position:sticky;top:0;background:#fff;padding:8px 0;z-index:1}textarea{width:100%;height:8em}
</style>
<h1>${esc(target)}</h1>
<div id="bar"><button onclick="copyFeedback()">Copy feedback</button> <span id="said"></span>
<textarea id="general" placeholder="general notes"></textarea></div>
<table>${body}</table>
<script>
function copyFeedback() {
  const out = []
  for (const tr of document.querySelectorAll('tr[data-id]')) {
    const { id, kind, t } = tr.dataset
    const now = tr.querySelector('.t').value.trim()
    const note = tr.querySelector('.note').value.trim()
    if (tr.classList.contains('nixed')) out.push('nix #' + id + ' [' + kind + '] ' + t)
    else if (now !== t) out.push('edit #' + id + ' [' + kind + '] ' + t + '\\n    -> ' + now)
    if (note) out.push('note #' + id + ' [' + kind + '] ' + t + '\\n    ' + note)
  }
  const general = document.getElementById('general').value.trim()
  if (general) out.push('general: ' + general)
  const text = out.join('\\n') || '(no changes)'
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.append(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
  navigator.clipboard?.writeText(text).catch(() => {})
  document.getElementById('said').textContent = 'copied ' + out.length + ' item(s)'
}
</script>`,
  )
  await import('node:child_process').then(({ spawn }) => spawn('open', [out]))
  console.log(`\nopened ${out}`)
}

if (listen) {
  for (const t of toPlay) {
    console.log(`▶ ${short(t)}`)
    await play(takePath(cacheDir, t, voice)).done
  }
}
