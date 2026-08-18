/**
 * Text-to-speech with word marks. Same posture as stt.ts: a few dozen lines of
 * Swift built by `swiftc` at boot, never an npm dependency, and a null when the
 * source or the compiler is missing — the caller falls back to `say` and the
 * reader reveals a whole fragment at a time the way it always has.
 *
 * The marks are what `say` cannot give: a character offset into the source text
 * paired with a millisecond offset into the audio. That pairing is what lets
 * the board show only what the room has actually heard.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { run } from './speech.ts'

/** One spoken word: where it sits in the source text, and when it is said. */
export type Mark = { loc: number; len: number; ms: number }
export type Aligned = { path: string; durationMs: number; marks: Mark[] }

/** The path to a working helper, or null. Rebuilds when the source is newer. */
export async function ttsBinary(dir: string): Promise<string | null> {
  const src = join(dir, 'tts.swift')
  const bin = join(dir, 'tts')
  if (!existsSync(src)) return null
  const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs
  if (!fresh) {
    const { ok } = await run('swiftc', ['-O', '-o', bin, src])
    if (!ok) {
      console.warn('[tts] swiftc build failed — falling back to `say`, reveal stays per-fragment')
      return null
    }
  }
  return bin
}

/**
 * Render `text` to `outPath` and return its word marks. The text goes via a
 * file rather than argv: a pack fragment is arbitrary prose, and a question
 * about the `-v` flag should not become a flag.
 */
export async function align(
  bin: string,
  text: string,
  outPath: string,
  voice?: string,
  rate?: number,
): Promise<Aligned | null> {
  const txt = `${outPath}.${randomUUID()}.txt`
  writeFileSync(txt, text, 'utf8')
  try {
    const args = [txt, outPath, voice ?? '']
    if (rate !== undefined) args.push(String(rate))
    const { ok, stdout } = await run(bin, args)
    if (!ok) return null
    const parsed = JSON.parse(stdout) as { durationMs: number; marks: Mark[] }
    return { path: outPath, durationMs: parsed.durationMs, marks: parsed.marks }
  } catch {
    return null
  } finally {
    rmSync(txt, { force: true })
  }
}

/**
 * The word being spoken at `ms`, as an index into `marks` — or -1 before the
 * first. The reveal cursor: everything up to `marks[i].loc + marks[i].len` has
 * been heard and may go on the board, and nothing past it may.
 */
export function spokenBy(marks: Mark[], ms: number): number {
  let lo = 0
  let hi = marks.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (marks[mid].ms <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** The prefix of `text` the room has heard by `ms`. Empty before the first word. */
export function heardBy(text: string, marks: Mark[], ms: number): string {
  const i = spokenBy(marks, ms)
  if (i < 0) return ''
  return text.slice(0, marks[i].loc + marks[i].len)
}
