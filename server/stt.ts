import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Transcriber } from './align.ts'
import { run } from './speech.ts'

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

export function transcribeSession(bin: string, audioPath: string): {
  transcribe: Transcriber
  close(): void
} {
  const p = spawn(bin, ['--session', audioPath])
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
  const drain = () => {
    while (waiting.length) waiting.shift()?.('')
  }
  p.on('close', drain)
  p.on('error', drain)

  return {
    transcribe: (fromMs, toMs) =>
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

export function transcribePool(bin: string, audioPath: string, width = 4): {
  transcribe: Transcriber
  close(): void
} {
  const sessions = Array.from({ length: Math.max(1, width) }, () => transcribeSession(bin, audioPath))
  const idle = [...sessions]
  const queue: ((s: (typeof sessions)[number]) => void)[] = []

  const take = () =>
    new Promise<(typeof sessions)[number]>((resolve) => {
      const free = idle.pop()
      if (free) resolve(free)
      else queue.push(resolve)
    })

  return {
    transcribe: async (fromMs, toMs) => {
      const s = await take()
      try {
        return await s.transcribe(fromMs, toMs)
      } finally {
        const next = queue.shift()
        if (next) next(s)
        else idle.push(s)
      }
    },
    close: () => sessions.forEach((s) => s.close()),
  }
}

export async function transcribe(bin: string, wavPath: string): Promise<string | null> {
  const { ok, stdout, stderr, signal } = await run(bin, [wavPath])
  if (stderr.trim()) console.warn(`[stt] ${stderr.trim()}`)
  if (signal) console.warn(`[stt] helper killed by ${signal} — start the server from Terminal, whose speech permission it borrows`)
  if (!ok) return null
  return stdout.trim() || null
}
