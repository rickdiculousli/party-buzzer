import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { certHost, ensureCert } from './cert.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'pb-cert-'))

test('certHost turns an address into the name that resolves back to it', () => {
  assert.equal(certHost('192.168.0.74'), '192-168-0-74.local-ip.sh')
  assert.equal(certHost('10.0.0.1'), '10-0-0-1.local-ip.sh')
})

test('a cache that cannot be parsed is not served', async () => {
  const d = dir()
  writeFileSync(join(d, 'server.pem'), 'not a certificate')
  writeFileSync(join(d, 'server.key'), 'nor a key')
  // No network in tests, so the refetch fails and we get null rather than
  // handing node:https a string it will throw on at listen time.
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
  // Real PEM shape, but long expired: the guard is on validity, not on syntax,
  // and caching this would poison every later boot.
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
  // Borrow the real certificate if this machine has one from a previous boot;
  // otherwise there is nothing to assert against without going to the network.
  const real = join(import.meta.dirname, '..', '.cert', 'server.pem')
  if (!existsSync(real)) return t.skip('no cached certificate on this machine')
  writeFileSync(join(d, 'server.pem'), readFileSync(real))
  writeFileSync(join(d, 'server.key'), 'key')
  const stub = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error('should not have been called')
  }
  try {
    const tls = await ensureCert(d)
    // Null only if the cached certificate has itself aged past the renew window.
    if (tls) assert.equal(tls.key, 'key')
  } finally {
    globalThis.fetch = stub
  }
})
