import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Clip = { path: string; durationMs: number }
export type Playback = {
  done: Promise<void>
  started: Promise<void>
  stop(): void
}
export type Speech = {
  render(cacheDir: string, text: string, voice?: string): Promise<Clip>
  play(path: string, fromMs?: number): Playback
  cached?(cacheDir: string, text: string): boolean
}

export function clipPath(cacheDir: string, text: string, voice?: string): string {
  const hash = createHash('sha256').update(`${voice ?? 'default'}\n${text}`).digest('hex')
  return join(cacheDir, `${hash.slice(0, 16)}.aiff`)
}

export function parseDuration(afinfoOutput: string): number {
  const m = /estimated duration:\s*([\d.]+)\s*sec/.exec(afinfoOutput)
  return m ? Math.round(Number(m[1]) * 1000) : 0
}

export function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; signal?: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const p = spawn(cmd, args)
    p.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    p.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    p.on('close', (code, signal) => resolve({ ok: code === 0, stdout, stderr, ...(signal && { signal }) }))
    p.on('error', () => resolve({ ok: false, stdout: '', stderr: '' }))
  })
}

export async function render(cacheDir: string, text: string, voice?: string): Promise<Clip> {
  mkdirSync(cacheDir, { recursive: true })
  const path = clipPath(cacheDir, text, voice)
  if (!existsSync(path)) {
    const tmp = `${path}.${randomUUID()}.tmp`
    const args = voice ? ['-v', voice, '-o', tmp, text] : ['-o', tmp, text]
    const { ok } = await run('say', args)
    if (!ok) {
      rmSync(tmp, { force: true })
      return { path, durationMs: 0 }
    }
    renameSync(tmp, path)
  }
  const { stdout } = await run('afinfo', [path])
  return { path, durationMs: parseDuration(stdout) }
}

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
    if (killed) return began()
    const p = bin ? spawn(bin, [path, String(fromMs / 1000)]) : spawn('afplay', [path])
    child = p
    if (bin) {
      p.stdout?.once('data', () => began())
    } else {
      began()
    }
    await new Promise<void>((resolve) => {
      p.on('close', () => resolve())
      p.on('error', () => resolve())
    })
    began()
  })()

  return {
    done,
    started,
    stop: () => {
      killed = true
      began()
      try {
        child?.kill('SIGKILL')
      } catch {
      }
    },
  }
}
