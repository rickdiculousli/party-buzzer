/**
 * Speech from ElevenLabs v4, one take per script, with a timestamp on every
 * character. The timestamps are the point: they say when the voice begins
 * each clause of the question, so the board reveals it in time with the voice.
 *
 * Takes cache like `say` clips, by a hash of script and voice: the mp3 and a
 * `.json` of its character times side by side. A take costs credits, so it
 * renders once, ever.
 *
 * The script may be performed — audio tags, ad-libs, a groan between clauses.
 * Tags are timed like any other characters but never match a word, and a
 * phrase is found by its words in order, so whatever the voice adds around it
 * is simply stepped over.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { candidates, norm, type Fold, type Joined } from './align.ts'
import { run, parseDuration, type Clip } from './speech.ts'

/** The script as sent, and when each of its characters starts and ends. */
export type Timed = { text: string; startMs: number[]; endMs: number[] }

const API = 'https://api.us.elevenlabs.io/v1'

/** The house voice, Buzzer Host – Dynamic. `ELEVENLABS_VOICE_ID` picks another. */
export const HOUSE_VOICE = 'zNJaLQEFmbGxVCTumuiK'

export function takePath(cacheDir: string, script: string, voiceId: string): string {
  const hash = createHash('sha256').update(`eleven:${voiceId}\n${script}`).digest('hex')
  return join(cacheDir, `${hash.slice(0, 16)}.mp3`)
}

/** The character times beside a take. Absent for a clip that is not one. */
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
    // Times first, audio last: the mp3 is what marks the take cached, so it
    // must never exist without its times. Temp-and-rename as in speech.ts.
    writeFileSync(path.replace(/\.mp3$/, '.json'), JSON.stringify(timed))
    const tmp = `${path}.${randomUUID()}.tmp`
    writeFileSync(tmp, Buffer.from(body.audio_base64, 'base64'))
    renameSync(tmp, path)
  }
  const { stdout } = await run('afinfo', [path])
  return { path, durationMs: parseDuration(stdout) }
}

/** Words with their character extents. Audio tags are blanked out first. */
function tokens(text: string): { word: string; at: number; end: number }[] {
  const bare = text.replace(/\[[^\]]*\]/g, (t) => ' '.repeat(t.length))
  const out: { word: string; at: number; end: number }[] = []
  for (const m of bare.matchAll(/\S+/g)) {
    // Doubled letters collapse on both sides, so a stretched "Reeed" still
    // matches the "Red" it performs.
    const word = norm(m[0]).replace(/(.)\1+/g, '$1')
    if (word) out.push({ word, at: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * For each word of `src`, the index of the script word it was spoken as, or -1.
 * Greedy and in order, looking a few words ahead so an ad-lib between two
 * words of the source is stepped over rather than breaking the match.
 * ponytail: a fixed look-ahead; an ad-lib longer than LOOKAHEAD words mid-phrase
 * loses the words after it — widen it or go to a real sequence alignment then.
 */
const LOOKAHEAD = 12
function match(src: { word: string }[], script: { word: string }[], from = 0): number[] {
  const out: number[] = []
  let cursor = from
  for (const [k, w] of src.entries()) {
    // A hit whose next word matches too beats the first bare hit: the "and" of
    // an ad-lib's "and yes" must not take the "and" of "and is best known".
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

/**
 * The reader's folds, read straight off the take. As in `locate`, a fold
 * reveals the clause ending at `at` and fires when the voice begins that
 * clause — so its time is the first word of the clause, not the word at `at`.
 * A clause whose first word was not found gets no fold; the next one reveals
 * it, which is late rather than early.
 */
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
