import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

const PRIVATE = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/

/** Private IPv4 addresses on this machine, excluding loopback and virtual NICs. */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    // Docker bridges and VPN tunnels are never the party WiFi.
    if (/^(docker|br-|veth|utun|tun|tap|awdl|llw)/i.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (PRIVATE.test(a.address)) out.push(a.address)
    }
  }
  return out
}

/** Home routers hand out 192.168.x.x, so prefer that when there's a choice. */
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

export function banner(url: string, qr: string): string {
  return [
    '',
    '  ┌─────────────────────────────────────────┐',
    '  │  PARTY BUZZER                           │',
    '  └─────────────────────────────────────────┘',
    '',
    `  Players join at:  ${url}`,
    '',
    qr,
    `  Host panel:   ${url}/host`,
    `  Big screen:   ${url}/board`,
    '',
    '  Ctrl-C to stop.',
    '',
  ].join('\n')
}
