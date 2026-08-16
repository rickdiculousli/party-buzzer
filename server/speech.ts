/**
 * Speech, pre-rendered. `say` synthesises at roughly realtime, so doing it live
 * would put a pause before every sentence; rendering the whole pack up front
 * turns playback into a file we control. That is also what makes pause real —
 * `afplay` under SIGSTOP resumes exactly where it stopped.
 *
 * Clips cache by a hash of the text and the voice, so a pack read twice renders
 * once, ever.
 *
 * macOS only. Without these binaries every call degrades to silence and the
 * game still runs — fragments appear, power still closes.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export type Clip = { path: string; durationMs: number }
export type Playback = {
  done: Promise<void>
  pause(): void
  resume(): void
  stop(): void
}
export type Speech = {
  render(cacheDir: string, text: string, voice?: string): Promise<Clip>
  play(path: string): Playback
}

export function clipPath(cacheDir: string, text: string, voice?: string): string {
  const hash = createHash('sha256').update(`${voice ?? 'default'}\n${text}`).digest('hex')
  return join(cacheDir, `${hash.slice(0, 16)}.aiff`)
}

/** `afinfo` prints `estimated duration: 4.847982 sec`. Milliseconds, 0 if absent. */
export function parseDuration(afinfoOutput: string): number {
  const m = /estimated duration:\s*([\d.]+)\s*sec/.exec(afinfoOutput)
  return m ? Math.round(Number(m[1]) * 1000) : 0
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    const p = spawn(cmd, args)
    p.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    p.on('close', (code) => resolve({ ok: code === 0, stdout }))
    p.on('error', () => resolve({ ok: false, stdout: '' }))
  })
}

export async function render(cacheDir: string, text: string, voice?: string): Promise<Clip> {
  mkdirSync(cacheDir, { recursive: true })
  const path = clipPath(cacheDir, text, voice)
  if (!existsSync(path)) {
    // Render to a temp path and rename into place on success, so a `say`
    // killed mid-render (the host, impatient during a ~30s pre-render) never
    // leaves a truncated clip cached under the real path forever. Rename is
    // atomic within a directory, which also covers two concurrent renders of
    // identical text racing for the same cache path.
    const tmp = `${path}.${randomUUID()}.tmp`
    const args = voice ? ['-v', voice, '-o', tmp, text] : ['-o', tmp, text]
    const { ok } = await run('say', args)
    if (!ok) {
      rmSync(tmp, { force: true })
      // No `say` on this box, or one bad fragment. Duration 0 means "play
      // nothing and move on" — the fragment still goes up on the board.
      return { path, durationMs: 0 }
    }
    renameSync(tmp, path)
  }
  const { stdout } = await run('afinfo', [path])
  return { path, durationMs: parseDuration(stdout) }
}

export function play(path: string): Playback {
  const p = spawn('afplay', [path])
  const done = new Promise<void>((resolve) => {
    p.on('close', () => resolve())
    p.on('error', () => resolve())
  })
  const signal = (sig: NodeJS.Signals) => {
    try {
      p.kill(sig)
    } catch {
      // Already gone. Nothing to hold or release.
    }
  }
  return {
    done,
    pause: () => signal('SIGSTOP'),
    // SIGCONT on a stopped afplay resumes sample-accurately; there is no seek
    // and none is needed.
    resume: () => signal('SIGCONT'),
    stop: () => {
      // A stopped process ignores SIGKILL until it is continued.
      signal('SIGCONT')
      signal('SIGKILL')
    },
  }
}
