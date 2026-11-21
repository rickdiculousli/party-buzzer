import { basename, resolve } from 'node:path'

const AUDIO = /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i

export function safeRaw(root: string, name: string): string | null {
  const base = basename(name)
  if (!base || base !== name || base.startsWith('.') || !AUDIO.test(base)) return null
  const full = resolve(root, base)
  return full.startsWith(resolve(root) + '/') ? full : null
}

export type AdoptOpts = {
  preset: 'one-shot' | 'bed'
  input: string
  output: string
  headMs: number
  cutMs: number
  rate: number
}

const FADE_S = 0.04

export function safeOut(name: string): string | null {
  return /^[a-z0-9-]+\.(wav|ogg)$/.test(name) ? name : null
}

export function ffmpegArgs(o: AdoptOpts): string[] {
  if (o.preset === 'bed')
    return ['-y', '-i', o.input, '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', o.output]

  const head = o.headMs / 1000
  const cut = o.cutMs / 1000
  const rate = Math.max(0.05, o.rate)
  const end = Number((head + cut * rate).toFixed(6))
  const chain = [cut > 0 ? `atrim=${head}:${end}` : `atrim=${head}`, 'asetpts=N/SR/TB']
  if (rate !== 1) chain.push(`asetrate=${Math.round(44100 * rate)}`, 'aresample=44100')
  if (cut > 0) {
    const st = Math.max(0, cut - FADE_S)
    chain.push(`afade=t=out:st=${Number(st.toFixed(4))}:d=${FADE_S}`)
  }
  return ['-y', '-i', o.input, '-af', chain.join(','), '-ac', '1', '-ar', '44100', o.output]
}

export function creditsRow(o: {
  out: string
  role: string
  source: string
  command: string
}): string {
  return `| \`${o.out}\` | ${o.role} | From \`${o.source}\` via \`${o.command}\` |\n`
}
