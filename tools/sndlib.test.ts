import test from 'node:test'
import assert from 'node:assert/strict'
import { safeRaw } from './sndlib.ts'

const ROOT = '/repo/sounds/raw'

test('a plain name resolves inside the holding ground', () => {
  assert.equal(safeRaw(ROOT, 'buzzer.wav'), '/repo/sounds/raw/buzzer.wav')
})

// Dev-only is not a reason to skip this. The moment a name crosses an HTTP
// boundary it is untrusted, and a traversal here reads any file on the machine.
test('a name escaping the holding ground is refused', () => {
  assert.equal(safeRaw(ROOT, '../../etc/passwd'), null)
  assert.equal(safeRaw(ROOT, '/etc/passwd'), null)
  assert.equal(safeRaw(ROOT, 'nested/../../out.wav'), null)
})

test('a name that is not audio is refused', () => {
  assert.equal(safeRaw(ROOT, 'notes.txt'), null)
  assert.equal(safeRaw(ROOT, ''), null)
})

import { safeOut, ffmpegArgs, creditsRow } from './sndlib.ts'

test('an output name must be lowercase, hyphenated, and audio', () => {
  assert.equal(safeOut('stamp.wav'), 'stamp.wav')
  assert.equal(safeOut('leader-2.ogg'), 'leader-2.ogg')
  assert.equal(safeOut('Stamp.wav'), null)
  assert.equal(safeOut('../stamp.wav'), null)
  assert.equal(safeOut('stamp.mp3'), null)
  assert.equal(safeOut('stamp'), null)
})

// The one-shot preset is the pass CREDITS.md has been describing by hand: trim,
// then the same 40ms release play() would have applied, mono, 44.1k, PCM.
// `cut` is output length from `head`, the same meaning play() and the audition
// give it — so a clip dialled to 3.14s is 3.14s of sound wherever it starts.
test('the one-shot preset trims, fades, and stays uncompressed', () => {
  const args = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/stamp.wav',
    headMs: 100,
    cutMs: 3140,
    rate: 1,
  })
  assert.deepEqual(args, [
    '-y',
    '-i',
    '/raw/in.wav',
    '-af',
    'atrim=0.1:3.24,asetpts=N/SR/TB,afade=t=out:st=3.1:d=0.04',
    '-ac',
    '1',
    '-ar',
    '44100',
    '/out/stamp.wav',
  ])
})

test('a rate other than 1 moves speed and pitch together, and the fade with them', () => {
  const args = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/leader.wav',
    headMs: 0,
    cutMs: 4000,
    rate: 2,
  })
  const af = args[args.indexOf('-af') + 1]
  assert.ok(af.includes('asetrate=88200'), af)
  assert.ok(af.includes('aresample=44100'), af)
  // 4s of output at 2x eats 8s of input, and the fade sits against the output.
  assert.ok(af.startsWith('atrim=0:8,'), af)
  assert.ok(af.includes('afade=t=out:st=3.96:d=0.04'), af)
})

// The case that was wrong: a head *and* a rate, where the input span consumed
// is neither the cut nor the cut plus the head.
test('cut is output length however the head and rate move the input span', () => {
  const af = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/x.wav',
    headMs: 200,
    cutMs: 500,
    rate: 2,
  })[4]
  // 0.5s out at 2x is 1s of input, starting 0.2s in.
  assert.ok(af.startsWith('atrim=0.2:1.2,'), af)
  assert.ok(af.includes('afade=t=out:st=0.46:d=0.04'), af)
})

test('a cut shorter than the fade never fades from before the start', () => {
  const af = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/x.wav',
    headMs: 0,
    cutMs: 20,
    rate: 1,
  })[4]
  assert.ok(af.includes('afade=t=out:st=0:d=0.04'), af)
})

test('cut 0 means the whole file and produces no atrim end', () => {
  const af = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/x.wav',
    headMs: 250,
    cutMs: 0,
    rate: 1,
  })[4]
  assert.ok(af.startsWith('atrim=0.25,'), af)
  assert.ok(!af.includes('afade'), 'no known end, so nothing to fade against')
})

test('the bed preset is opus and nothing else', () => {
  assert.deepEqual(
    ffmpegArgs({ preset: 'bed', input: '/raw/m.wav', output: '/out/welcome.ogg', headMs: 0, cutMs: 0, rate: 1 }),
    ['-y', '-i', '/raw/m.wav', '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', '/out/welcome.ogg'],
  )
})

test('a credits row carries the command that produced the file', () => {
  const row = creditsRow({
    out: 'stamp.wav',
    role: 'A mark landing',
    source: 'raw/click.wav',
    command: 'ffmpeg -y -i a b',
  })
  assert.match(row, /^\| `stamp.wav` \| A mark landing \| /)
  assert.ok(row.includes('`ffmpeg -y -i a b`'))
  assert.ok(row.endsWith(' |\n'))
})
