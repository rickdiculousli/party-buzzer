/**
 * Mono 16-bit PCM WAV. WAV sidesteps the browser codec lottery — Safari gives
 * MediaRecorder AAC, Chrome Opus-in-WebM, and stock macOS cannot decode the
 * latter — and SFSpeech reads it directly. The header carries the real rate,
 * so no resampling step earns its place.
 */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength)
  const v = new DataView(buf)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  new Int16Array(buf, 44).set(pcm)
  return buf
}
