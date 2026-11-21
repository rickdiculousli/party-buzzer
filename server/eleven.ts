import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { candidates, norm, type Fold, type Joined } from './align.ts'
import { run, parseDuration, type Clip } from './speech.ts'

export type Timed = { text: string; startMs: number[]; endMs: number[] }

const API = 'https://api.us.elevenlabs.io/v1'

export const HOUSE_VOICE = 'zNJaLQEFmbGxVCTumuiK'

export function takePath(cacheDir: string, script: string, voiceId: string): string {
  const hash = createHash('sha256').update(`eleven:${voiceId}\n${script}`).digest('hex')
  return join(cacheDir, `${hash.slice(0, 16)}.mp3`)
}

export function timedFor(clipPath: string): Timed | undefined {
  const p = clipPath.replace(/\.mp3$/, '.json')
  if (p === clipPath || !existsSync(p)) return undefined
  return JSON.parse(readFileSync(p, 'utf8'))
}

export async function synthesize(
  cacheDir: string,
  script: string,
  voiceId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Clip> {
  mkdirSync(cacheDir, { recursive: true })
  const path = takePath(cacheDir, script, voiceId)
  if (!existsSync(path)) {
    const res = await fetchImpl(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: script, model_id: 'eleven_v4' }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as {
      audio_base64: string
      alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
    }
    const a = body.alignment
    const timed: Timed = {
      text: a.characters.join(''),
      startMs: a.character_start_times_seconds.map((s) => Math.round(s * 1000)),
      endMs: a.character_end_times_seconds.map((s) => Math.round(s * 1000)),
    }
    writeFileSync(path.replace(/\.mp3$/, '.json'), JSON.stringify(timed))
    const tmp = `${path}.${randomUUID()}.tmp`
    writeFileSync(tmp, Buffer.from(body.audio_base64, 'base64'))
    renameSync(tmp, path)
  }
  const { stdout } = await run('afinfo', [path])
  return { path, durationMs: parseDuration(stdout) }
}

function tokens(text: string): { word: string; at: number; end: number }[] {
  const bare = text.replace(/\[[^\]]*\]/g, (t) => ' '.repeat(t.length))
  const out: { word: string; at: number; end: number }[] = []
  for (const m of bare.matchAll(/\S+/g)) {
    const word = norm(m[0]).replace(/(.)\1+/g, '$1')
    if (word) out.push({ word, at: m.index, end: m.index + m[0].length })
  }
  return out
}

const LOOKAHEAD = 12
function match(src: { word: string }[], script: { word: string }[], from = 0): number[] {
  const out: number[] = []
  let cursor = from
  for (const [k, w] of src.entries()) {
    const next = src[k + 1]?.word
    let hit = -1
    for (let i = cursor; i < Math.min(script.length, cursor + LOOKAHEAD); i++) {
      if (script[i].word !== w.word) continue
      if (hit < 0) hit = i
      if (next === undefined || script[i + 1]?.word === next) {
        hit = i
        break
      }
    }
    out.push(hit)
    if (hit >= 0) cursor = hit + 1
  }
  return out
}

export function folds(j: Joined, timed: Timed): Fold[] {
  const src = tokens(j.text)
  const script = tokens(timed.text)
  const m = match(src, script)
  const out: Fold[] = []
  let begins = 0
  for (const c of candidates(j)) {
    const k = src.findIndex((w) => w.at >= begins)
    if (k >= 0 && m[k] >= 0) out.push({ at: c.at, ms: timed.startMs[script[m[k]].at], kind: c.kind, sure: true })
    begins = c.at
  }
  return out
}
