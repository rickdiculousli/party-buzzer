/**
 * Fills the sound library with something to actually pick from.
 *
 *   npm run demo-sounds          # generate
 *   npm run demo-sounds clean    # take them all back out
 *
 * The Library panel and the `+ layer` picker are both lists, and an empty list
 * teaches nothing: you cannot tell what auditioning is *for* until there are
 * six candidates and five of them are wrong. So this drops a believable holding
 * ground into `sounds/raw/` — deliberately messy names, the shape a real
 * afternoon of downloading leaves behind — plus two already-adopted files so
 * the picker has entries that are not the three anchor cues.
 *
 * Everything is synthesized by ffmpeg from `lavfi` sources. Nothing is
 * downloaded, nothing is vendored, and no file here is a candidate for the real
 * board — they are shapes to look at in the editor and drag the ends of.
 *
 * ponytail: five raw files and two adopted, hard-coded. A generator with
 * parameters would be a synthesizer, and there is one of those in the browser
 * already.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const RAW = fileURLToPath(new URL('../sounds/raw', import.meta.url))
const OUT = fileURLToPath(new URL('../client/public/sounds', import.meta.url))

/**
 * The generated set.
 *
 * `filter` is the lavfi source plus whatever shapes it, as one `-f lavfi -i`
 * argument. Each one is a different silhouette on purpose — a click that is
 * two pixels wide, a buzz that is a solid block, a sweep that swells, a bed
 * that never resolves — because the point of drawing a waveform is telling
 * them apart at a glance.
 *
 * The raw names are ugly on purpose. Freesound gives you `512345__someguy__`
 * prefixes, browsers give you ` (1)` suffixes, and the Library has to look
 * like the place those land or it is not showing you the real job. Two of
 * them are also names `safeOut` will refuse, which is the other half of the
 * lesson: adopting is where a name gets cleaned up.
 */
const RAW_FILES = [
  {
    name: '512345__someguy__big-buzzer-take2.wav',
    filter: "aevalsrc='0.5*sgn(sin(2*PI*180*t))':d=2,afade=t=out:st=1.9:d=0.1",
  },
  {
    name: 'ui click sharp (1).wav',
    filter: 'sine=frequency=1800:duration=0.12,afade=t=out:st=0.02:d=0.1',
  },
  {
    name: 'whoosh_long_v3.wav',
    filter: 'anoisesrc=d=1.5:c=pink:a=0.6,afade=t=in:st=0:d=1.1,afade=t=out:st=1.2:d=0.3',
  },
  {
    name: '87211__crowdguy__applause-small-room.wav',
    filter: 'anoisesrc=d=4:c=brown:a=0.5,afade=t=in:st=0:d=0.3,afade=t=out:st=3.4:d=0.6',
  },
  {
    name: 'bell-ding-bright-FINAL-v2.wav',
    filter: 'sine=frequency=1046:duration=1.2,afade=t=out:st=0.05:d=1.15',
  },
]

/**
 * The two that arrive already adopted, so the `+ layer` picker has something
 * in it beyond the anchor cues on the very first run.
 *
 * Named `demo-` and gitignored, which is the one thing to be careful about:
 * a layer pointing at one of these is a layer that plays on your machine and
 * 404s on anyone else's. Delete them with `clean` before you save a recipe you
 * mean to keep.
 */
const ADOPTED = [
  { name: 'demo-blip.wav', filter: 'sine=frequency=660:duration=0.18,afade=t=out:st=0.04:d=0.14' },
  {
    name: 'demo-sweep.wav',
    filter: 'anoisesrc=d=0.9:c=white:a=0.4,afade=t=in:st=0:d=0.6,afade=t=out:st=0.7:d=0.2',
  },
]

/** Mono 44.1k PCM, matching what the one-shot adopt preset produces. */
async function generate(dir: string, name: string, filter: string): Promise<void> {
  await run('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', filter,
    '-ac', '1',
    '-ar', '44100',
    '-c:a', 'pcm_s16le',
    resolve(dir, name),
  ])
}

async function clean(): Promise<void> {
  for (const { name } of RAW_FILES) await rm(resolve(RAW, name), { force: true })
  // Every demo-*, not just the two named above — a file adopted out of the raw
  // set during a session is one of these too, and leaving it behind is exactly
  // the stale-reference footgun the naming exists to make sweepable.
  const left = await readdir(OUT).catch(() => [] as string[])
  for (const name of left)
    if (name.startsWith('demo-')) await rm(resolve(OUT, name), { force: true })
  console.log('removed the demo sounds from sounds/raw/ and client/public/sounds/')
}

async function main(): Promise<void> {
  if (process.argv[2] === 'clean') return clean()

  await mkdir(RAW, { recursive: true })
  for (const { name, filter } of RAW_FILES) await generate(RAW, name, filter)
  for (const { name, filter } of ADOPTED) await generate(OUT, name, filter)

  console.log(`${RAW_FILES.length} files in sounds/raw/ — the Library panel`)
  for (const { name } of RAW_FILES) console.log(`  ${name}`)
  console.log(`${ADOPTED.length} in client/public/sounds/ — the + layer picker`)
  for (const { name } of ADOPTED) console.log(`  ${name}`)
  console.log(
    '\nBoth sets are gitignored throwaways. A recipe that names a demo- file\n' +
      'plays here and 404s everywhere else, so run `npm run demo-sounds clean`\n' +
      'before saving a cue you mean to keep.',
  )
}

main().catch((err: NodeJS.ErrnoException) => {
  console.error(err.code === 'ENOENT' ? 'ffmpeg is not on PATH' : err.message)
  process.exit(1)
})
