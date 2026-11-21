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
    domain: 'my.local-ip.co',
    certUrl: 'https://local-ip.co/cert/server.pem',
    keyUrl: 'https://local-ip.co/cert/server.key',
  },
]

const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000

export type Tls = { key: string; cert: string }

export function certHost(ip: string, provider = PROVIDERS[0]): string {
  return `${ip.replaceAll('.', '-')}.${provider.domain}`
}

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

async function completeChain(pem: string): Promise<string> {
  if (pem.split('BEGIN CERTIFICATE').length > 2) return pem
  const leaf = new X509Certificate(pem)
  const url = /CA Issuers - URI:(\S+)/.exec(leaf.infoAccess ?? '')?.[1]
  if (!url) return pem
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  const issuer = new X509Certificate(Buffer.from(await res.arrayBuffer()))
  if (!leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey))
    throw new Error(`${url} is not the issuer`)
  return `${pem.trimEnd()}\n${issuer.toString()}`
}

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
  }

  try {
    const [leaf, key] = await Promise.all([fetchText(provider.certUrl), fetchText(provider.keyUrl)])
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
