/**
 * Speech-to-text, one spawn per answer. The helper is a few dozen lines of
 * Swift built by `swiftc` on demand at server boot — the same machine-binary
 * posture as `say`/`afplay`/`ffmpeg`, never an npm dependency. Without the
 * source or the compiler every call degrades to null and the judge stays off,
 * the way speech.ts degrades to silence.
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from './align.ts'
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

/**
 * A clip held open for questioning. The aligner asks one clip hundreds of
 * ranges, and nine tenths of a one-shot run is process startup, so the process
 * outlives the probe. Serial by construction: the bisection cannot ask its next
 * question until this one is answered. Run whole questions concurrently to keep
 * the machine busy — about four at once, past which the speech daemon
 * serialises anyway.
 */
export function probeSession(bin: string, audioPath: string): {
  probe: Probe
  close(): void
} {
  const p = spawn(bin, ['--probe', audioPath])
  p.stdout.setEncoding('utf8')

  let buffered = ''
  const waiting: ((line: string) => void)[] = []
  p.stdout.on('data', (chunk: string) => {
    buffered += chunk
    let nl: number
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl)
      buffered = buffered.slice(nl + 1)
      waiting.shift()?.(line)
    }
  })
  // A helper that dies mid-alignment must not hang the render: every question
  // still queued gets an empty answer, which the aligner reads as "no word has
  // finished" and turns into a fold at the end of the clip.
  const drain = () => {
    while (waiting.length) waiting.shift()?.('')
  }
  p.on('close', drain)
  p.on('error', drain)

  return {
    probe: (fromMs, toMs) =>
      new Promise<string[]>((resolve) => {
        waiting.push((line) => resolve(line.split(/\s+/).filter(Boolean)))
        p.stdin.write(`${Math.round(fromMs)} ${Math.round(toMs)}\n`)
      }),
    close: () => {
      p.stdin.end()
      p.kill()
    },
  }
}

/** One file in, one transcript out. Any failure is a null: the caller scores a miss. */
export async function transcribe(bin: string, wavPath: string): Promise<string | null> {
  const { ok, stdout } = await run(bin, [wavPath])
  if (!ok) return null
  return stdout.trim() || null
}
