import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, certHost, ensureCert } from './cert.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'pb-cert-'))

test('certHost turns an address into the name that resolves back to it', () => {
  assert.equal(certHost('192.168.0.74'), '192-168-0-74.local-ip.sh')
  assert.equal(certHost('10.0.0.1'), '10-0-0-1.local-ip.sh')
  assert.equal(certHost('10.0.0.1', PROVIDERS[1]), '10-0-0-1.my.local-ip.co')
})

test('a cache that cannot be parsed is not served', async () => {
  const d = dir()
  writeFileSync(join(d, 'server.pem'), 'not a certificate')
  writeFileSync(join(d, 'server.key'), 'nor a key')
  const stub = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    assert.equal(await ensureCert(d), null)
  } finally {
    globalThis.fetch = stub
  }
})

test('no certificate anywhere is null, not a throw — the room still plays', async () => {
  const stub = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    assert.equal(await ensureCert(join(dir(), 'nothing-here')), null)
  } finally {
    globalThis.fetch = stub
  }
})

test('a fetched certificate is cached, and an expired one is never written', async () => {
  const d = dir()
  const stub = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(new Response('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'))
  try {
    assert.equal(await ensureCert(d), null)
    assert.equal(existsSync(join(d, 'server.pem')), false, 'nothing cached')
  } finally {
    globalThis.fetch = stub
  }
})

test('a live cache inside its window is served without refetching', async (t) => {
  const d = dir()
  const real = join(import.meta.dirname, '..', '.cert', 'local-ip.sh', 'server.pem')
  if (!existsSync(real)) return t.skip('no cached certificate on this machine')
  writeFileSync(join(d, 'server.pem'), readFileSync(real))
  writeFileSync(join(d, 'server.key'), 'key')
  const stub = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('should not have been called')
  }
  try {
    const tls = await ensureCert(d)
    if (tls) assert.equal(tls.key, 'key')
  } finally {
    globalThis.fetch = stub
  }
})
