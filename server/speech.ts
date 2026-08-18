/**
 * Speech, pre-rendered. `say` synthesises at roughly realtime, so doing it live
 * would put a pause before every sentence; rendering the whole pack up front
 * turns playback into a file we control — cheap to start, cheap to abandon,
 * which is what makes the reader's pause instant.
 *
 * Clips cache by a hash of the text and the voice, so a pack read twice renders
 * once, ever.
 *
 * macOS only. Without these binaries every call degrades to silence and the
 * game still runs — fragments appear, power still closes.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Clip = { path: string; durationMs: number }
export type Playback = {
  done: Promise<void>
  /** Resolves when sound is actually coming out, not when the process spawned. */
  started: Promise<void>
  stop(): void
}
export type Speech = {
  render(cacheDir: string, text: string, voice?: string): Promise<Clip>
  play(path: string, fromMs?: number): Playback
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

export function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
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

/**
 * The seeking player, built once per process. Null means swiftc or the source
 * is missing, and playback falls back to `afplay` — which cannot seek, so a
 * resume starts the question over rather than picking up where it stopped.
 */
let player: Promise<string | null> | undefined
export function playerBinary(): Promise<string | null> {
  if (!player) {
    const dir = join(import.meta.dirname, 'play')
    const src = join(dir, 'play.swift')
    const bin = join(dir, 'play')
    player = (async () => {
      if (!existsSync(src)) return null
      const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs
      if (!fresh) {
        const { ok } = await run('swiftc', ['-O', '-o', bin, src])
        if (!ok) {
          console.warn('[speech] swiftc build failed — a resumed question starts over')
          return null
        }
      }
      return bin
    })()
  }
  return player
}

export function play(path: string, fromMs = 0): Playback {
  let began = () => {}
  const started = new Promise<void>((resolve) => {
    began = resolve
  })
  let child: ReturnType<typeof spawn> | undefined
  let killed = false

  const done = (async () => {
    const bin = await playerBinary()
    // Stopped before it ever started — a buzz landing in the moment between
    // asking for the clip and getting it. Release `started` anyway: a caller
    // waiting on sound that is never going to come waits forever.
    if (killed) return began()
    // No player and an offset to honour: starting over is wrong but audible,
    // where silence would look like the reader had died.
    const p = bin ? spawn(bin, [path, String(fromMs / 1000)]) : spawn('afplay', [path])
    child = p
    if (bin) {
      // One line, then playback. Anything on stdout means sound is out.
      p.stdout?.once('data', () => began())
    } else {
      began()
    }
    await new Promise<void>((resolve) => {
      p.on('close', () => resolve())
      p.on('error', () => resolve())
    })
    // A clip that never announced itself still has to release anything waiting.
    began()
  })()

  return {
    done,
    started,
    // Killing is the only way to stop cleanly. SIGSTOP looks tidier and sounds
    // awful: a frozen afplay cannot refill CoreAudio's ring buffer, so the
    // device loops the last fraction of a second three or four times before it
    // finally goes quiet. The reader replays the fragment instead of seeking.
    stop: () => {
      killed = true
      began()
      try {
        child?.kill('SIGKILL')
      } catch {
        // Already gone. Nothing to stop.
      }
    },
  }
}
