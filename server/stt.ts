/**
 * Speech-to-text, one spawn per answer. The helper is a few dozen lines of
 * Swift built by `swiftc` on demand at server boot — the same machine-binary
 * posture as `say`/`afplay`/`ffmpeg`, never an npm dependency. Without the
 * source or the compiler every call degrades to null and the judge stays off,
 * the way speech.ts degrades to silence.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './speech.ts'

/**
 * The path to a working helper, or null. Rebuilds when the source is newer, so
 * an edit to stt.swift takes effect on the next boot with nothing to remember.
 */
export async function sttBinary(dir: string): Promise<string | null> {
  const src = join(dir, 'stt.swift')
  const bin = join(dir, 'stt')
  if (!existsSync(src)) return null
  const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs
  if (!fresh) {
    const { ok } = await run('swiftc', ['-O', '-o', bin, src])
    if (!ok) {
      console.warn('[stt] swiftc build failed — spoken answers are off, the host judges')
      return null
    }
  }
  return bin
}

/** One file in, one transcript out. Any failure is a null: the caller scores a miss. */
export async function transcribe(bin: string, wavPath: string): Promise<string | null> {
  const { ok, stdout } = await run(bin, [wavPath])
  if (!ok) return null
  return stdout.trim() || null
}
