import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav } from './wav.ts'

test('the header is a well-formed mono 16-bit WAV at the given rate', () => {
  const buf = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000)
  const v = new DataView(buf)
  const str = (off: number, n: number) =>
    String.fromCharCode(...new Uint8Array(buf, off, n))
  assert.equal(str(0, 4), 'RIFF')
  assert.equal(v.getUint32(4, true), 36 + 6)
  assert.equal(str(8, 4), 'WAVE')
  assert.equal(str(12, 4), 'fmt ')
  assert.equal(v.getUint16(20, true), 1, 'PCM')
  assert.equal(v.getUint16(22, true), 1, 'mono')
  assert.equal(v.getUint32(24, true), 16000)
  assert.equal(str(36, 4), 'data')
  assert.equal(v.getUint32(40, true), 6)
  assert.equal(buf.byteLength, 44 + 6)
})

test('samples clamp and scale to 16-bit', () => {
  const buf = encodeWav(new Float32Array([1, -1, 2, -2]), 8000)
  const pcm = new Int16Array(buf, 44)
  assert.deepEqual([...pcm], [32767, -32768, 32767, -32768])
})
