import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from './speech.ts'
import { transcribeSession, sttBinary } from './stt.ts'

const SPOKEN = 'This Russian composer wrote a ballet about a nutcracker. ' +
  'He also wrote the 1812 Overture, which calls for cannon fire.'

/** Rendered rather than checked in, the way the demo sounds are. */
async function fixture(dir: string): Promise<string | null> {
  const path = join(dir, 'probe.aiff')
  const { ok } = await run('say', ['-o', path, SPOKEN])
  return ok ? path : null
}

/**
 * One probe at a time, each awaited before the next is sent — which is how the
 * aligner uses it, and the only shape that catches the bug this test exists
 * for. Writing every request first and reading afterwards passes even when the
 * helper never flushes, because the buffer empties when the process exits.
 */
test('a held-open clip answers one probe before being asked the next', async (t) => {
  const bin = await sttBinary(join(import.meta.dirname, 'stt'))
  if (!bin) return t.skip('no swiftc / no helper source')

  const dir = mkdtempSync(join(tmpdir(), 'probe-'))
  const audio = await fixture(dir)
  if (!audio) {
    rmSync(dir, { recursive: true, force: true })
    return t.skip('no `say` on this box')
  }

  const s = transcribeSession(bin, audio)
  try {
    // A deadlock here is silent and indefinite: both sides idle at zero CPU
    // waiting for the other. Fail loudly instead of hanging the suite.
    const answered = <T,>(p: Promise<T>) =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('no answer in 30s — the helper is not flushing')), 30_000),
        ),
      ])

    const early = await answered(s.transcribe(0, 2900))
    const later = await answered(s.transcribe(0, 7314))

    assert.ok(early.length > 0, 'the first probe answered at all')
    assert.ok(
      later.length > early.length,
      `more audio must yield at least as many words: ${early.length} then ${later.length}`,
    )
    // The clip is the same one every time, so a later cut extends the earlier.
    assert.equal(later.slice(0, early.length).join(' ').toLowerCase(), early.join(' ').toLowerCase())
  } finally {
    s.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a helper that dies mid-alignment answers everything still queued', async (t) => {
  const bin = await sttBinary(join(import.meta.dirname, 'stt'))
  if (!bin) return t.skip('no swiftc / no helper source')

  // Nothing to open, so the helper exits immediately. Every pending probe must
  // still settle — an unresolved promise would hang the whole pack render, and
  // an empty answer is read as "no word finished yet", folding at the clip end.
  const s = transcribeSession(bin, join(import.meta.dirname, 'stt', 'no-such-file.aiff'))
  const answers = await Promise.all([s.transcribe(0, 1000), s.transcribe(0, 2000)])
  assert.deepEqual(answers, [[], []], 'a dead helper resolves rather than hangs')
  s.close()
})
