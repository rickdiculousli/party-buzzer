import { execFile } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const RAW = fileURLToPath(new URL('../sounds/raw', import.meta.url))
const OUT = fileURLToPath(new URL('../client/public/sounds', import.meta.url))

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

const ADOPTED = [
  { name: 'demo-blip.wav', filter: 'sine=frequency=660:duration=0.18,afade=t=out:st=0.04:d=0.14' },
  {
    name: 'demo-sweep.wav',
    filter: 'anoisesrc=d=0.9:c=white:a=0.4,afade=t=in:st=0:d=0.6,afade=t=out:st=0.7:d=0.2',
  },
]

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
