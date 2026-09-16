import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from './speech.ts'
import { transcribeSession, sttBinary } from './stt.ts'

const SPOKEN = 'This clip keeps the native helper open while its line protocol is tested.'

/** Rendered rather than checked in, the way the demo sounds are. */
async function fixture(dir: string): Promise<string | null> {
  const path = join(dir, 'clip.aiff')
  const { ok } = await run('say', ['-o', path, SPOKEN])
  return ok ? path : null
}

/**
 * One request at a time, each awaited before the next is sent — which is how the
 * aligner uses it, and the only shape that catches the bug this test exists
 * for. Zero-length ranges make the native helper answer without involving the
 * nondeterministic macOS recognition service; this test owns the line protocol
 * and flushing contract, not Apple's transcription quality.
 */
test('a held-open helper flushes one reply before being asked for the next', async (t) => {
  const bin = await sttBinary(join(import.meta.dirname, 'stt'))
  if (!bin) return t.skip('no swiftc / no helper source')

  const dir = mkdtempSync(join(tmpdir(), 'stt-'))
  const audio = await fixture(dir)
  if (!audio) {
    rmSync(dir, { recursive: true, force: true })
    return t.skip('no `say` on this box')
  }

  const s = transcribeSession(bin, audio)
  try {
    // A deadlock here is silent and indefinite: both sides idle at zero CPU
    // waiting for the other. Fail loudly instead of hanging the suite.
    const answered = <T,>(p: Promise<T>) => new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no answer in 30s — the helper is not flushing')), 30_000)
      p.then(
        (value) => { clearTimeout(timeout); resolve(value) },
        (error) => { clearTimeout(timeout); reject(error) },
      )
    })

    assert.deepEqual(await answered(s.transcribe(0, 0)), [])
    assert.deepEqual(await answered(s.transcribe(1000, 1000)), [])
  } finally {
    s.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a helper that dies mid-alignment answers everything still queued', async (t) => {
  const bin = await sttBinary(join(import.meta.dirname, 'stt'))
  if (!bin) return t.skip('no swiftc / no helper source')

  // Nothing to open, so the helper exits immediately. Every pending request must
  // still settle — an unresolved promise would hang the whole pack render, and
  // an empty answer is read as "no word finished yet", folding at the clip end.
  const s = transcribeSession(bin, join(import.meta.dirname, 'stt', 'no-such-file.aiff'))
  const answers = await Promise.all([s.transcribe(0, 1000), s.transcribe(0, 2000)])
  assert.deepEqual(answers, [[], []], 'a dead helper resolves rather than hangs')
  s.close()
})
