/**
 * TLS for a LAN IP, so phones get a secure context.
 *
 * `getUserMedia` — and every other powerful API — is refused outside a secure
 * context, and a plain-http LAN address is not one. Browsers do not merely
 * refuse it: they leave `navigator.mediaDevices` undefined, so the request for
 * mic permission never even prompts. Push-to-talk cannot work over http.
 *
 * A CA will not issue a certificate to 192.168.x.x, because there is nothing to
 * domain-validate. local-ip.sh works around that with public DNS: the hostname
 * carries the address, `192-168-0-74.local-ip.sh` resolves to 192.168.0.74, and
 * they publish a real Let's Encrypt wildcard for `*.local-ip.sh` along with its
 * private key. A published key is worthless against a man in the middle — but
 * the threat model for a buzzer on a living-room LAN is nobody, and what it
 * buys is a secure context with no warning interstitial and nothing to install
 * on a guest's phone.
 *
 * ponytail: one hard-coded provider, no fallback to a second one. If local-ip.sh
 * goes away the server serves http and says so, which is exactly today's
 * behaviour; swap the two URLs if a better host appears.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { join } from 'node:path'

const CERT_URL = 'https://local-ip.sh/server.pem'
const KEY_URL = 'https://local-ip.sh/server.key'

/**
 * Refetch this long before expiry. The wildcard is a normal 90-day Let's
 * Encrypt certificate, so it turns over four times a year and a party can
 * easily fall on the wrong side of one.
 */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000

export type Tls = { key: string; cert: string }

/** The hostname that resolves to this address. Dots to dashes, nothing else. */
export function certHost(ip: string): string {
  return `${ip.replaceAll('.', '-')}.local-ip.sh`
}

/** Whether a PEM chain is present, parseable and not about to lapse. */
function usable(cert: string): boolean {
  try {
    return new Date(new X509Certificate(cert).validTo).getTime() - Date.now() > RENEW_BEFORE_MS
  } catch {
    return false
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.text()
}

/**
 * The cached certificate, refetched when missing or near expiry. Null means we
 * could not get one — no internet at boot, or the provider is down — and the
 * caller should serve plain http rather than fail to start. A buzzer that boots
 * without a microphone is a working buzzer; one that does not boot is not.
 */
export async function ensureCert(dir: string): Promise<Tls | null> {
  const certPath = join(dir, 'server.pem')
  const keyPath = join(dir, 'server.key')

  try {
    const [cert, key] = await Promise.all([
      readFile(certPath, 'utf8'),
      readFile(keyPath, 'utf8'),
    ])
    if (usable(cert)) return { cert, key }
  } catch {
    // No cache yet, or half a cache. Fetch below.
  }

  try {
    const [cert, key] = await Promise.all([fetchText(CERT_URL), fetchText(KEY_URL)])
    // Never cache something we cannot serve: a truncated download would
    // otherwise poison every later boot until someone deleted it by hand.
    if (!usable(cert)) throw new Error('fetched certificate is expired or unparseable')
    await mkdir(dir, { recursive: true })
    await Promise.all([writeFile(certPath, cert), writeFile(keyPath, key)])
    return { cert, key }
  } catch (err) {
    console.warn(`[cert] no certificate (${(err as Error).message})`)
    return null
  }
}
