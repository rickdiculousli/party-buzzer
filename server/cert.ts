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
 * Two providers run the same scheme, tried in order: local-ip.sh, then
 * local-ip.co. The server checks each one end to end at boot and serves http
 * when neither works.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { join } from 'node:path'

export type Provider = { domain: string; certUrl: string; keyUrl: string }

export const PROVIDERS: Provider[] = [
  {
    domain: 'local-ip.sh',
    certUrl: 'https://local-ip.sh/server.pem',
    keyUrl: 'https://local-ip.sh/server.key',
  },
  {
    // Its published chain.pem belongs to an older certificate from another CA,
    // so it is never fetched: `completeChain` finds the real issuer instead.
    domain: 'my.local-ip.co',
    certUrl: 'https://local-ip.co/cert/server.pem',
    keyUrl: 'https://local-ip.co/cert/server.key',
  },
]

/**
 * Refetch this long before expiry. The wildcard is a normal 90-day Let's
 * Encrypt certificate, so it turns over four times a year and a party can
 * easily fall on the wrong side of one.
 */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000

export type Tls = { key: string; cert: string }

/** The hostname that resolves to this address. Dots to dashes, nothing else. */
export function certHost(ip: string, provider = PROVIDERS[0]): string {
  return `${ip.replaceAll('.', '-')}.${provider.domain}`
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
 * A lone leaf certificate with its issuer appended, fetched from the address
 * the leaf names for it. Browsers will often fetch a missing intermediate
 * themselves; Node and some phones will not, and then the certificate does
 * not verify at all.
 */
async function completeChain(pem: string): Promise<string> {
  if (pem.split('BEGIN CERTIFICATE').length > 2) return pem
  const leaf = new X509Certificate(pem)
  const url = /CA Issuers - URI:(\S+)/.exec(leaf.infoAccess ?? '')?.[1]
  if (!url) return pem
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  const issuer = new X509Certificate(Buffer.from(await res.arrayBuffer()))
  // checkIssued compares names only; verify is the signature. The issuer comes
  // over plain http, so without it anyone on the path could swap it.
  if (!leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey))
    throw new Error(`${url} is not the issuer`)
  return `${pem.trimEnd()}\n${issuer.toString()}`
}

/**
 * The cached certificate, refetched when missing or near expiry. Null means we
 * could not get one — no internet at boot, or the provider is down — and the
 * caller should serve plain http rather than fail to start. A buzzer that boots
 * without a microphone is a working buzzer; one that does not boot is not.
 */
export async function ensureCert(dir: string, provider = PROVIDERS[0]): Promise<Tls | null> {
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
    const [leaf, key] = await Promise.all([fetchText(provider.certUrl), fetchText(provider.keyUrl)])
    // Never cache something we cannot serve: a truncated download would
    // otherwise poison every later boot until someone deleted it by hand.
    if (!usable(leaf)) throw new Error('fetched certificate is expired or unparseable')
    const cert = await completeChain(leaf)
    await mkdir(dir, { recursive: true })
    await Promise.all([writeFile(certPath, cert), writeFile(keyPath, key)])
    return { cert, key }
  } catch (err) {
    console.warn(`[cert] no certificate from ${provider.domain} (${(err as Error).message})`)
    return null
  }
}
