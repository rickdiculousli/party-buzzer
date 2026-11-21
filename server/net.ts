import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

const PRIVATE = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/

export function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|utun|tun|tap|awdl|llw)/i.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (PRIVATE.test(a.address)) out.push(a.address)
    }
  }
  return out
}

export function pickAddress(candidates: string[], override?: string): string {
  if (override) return override
  const preferred = candidates.find((a) => a.startsWith('192.168.'))
  return preferred ?? candidates[0] ?? '127.0.0.1'
}

export function qrFor(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'terminal', small: true })
}

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1 })
}

export function link(url: string): string {
  return process.stdout.isTTY ? `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\` : url
}

export function banner(url: string, qr: string): string {
  return [
    '',
    '  ┌─────────────────────────────────────────┐',
    '  │  PARTY BUZZER                           │',
    '  └─────────────────────────────────────────┘',
    '',
    `  Players join at:  ${link(url)}`,
    '',
    qr,
    `  Host panel:   ${link(`${url}/host`)}`,
    `  Big screen:   ${link(`${url}/board`)}`,
    '',
    '  Ctrl-C to stop.',
    '',
  ].join('\n')
}
