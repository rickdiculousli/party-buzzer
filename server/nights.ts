import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { nightKeepsake } from '../shared/recap.ts'
import type { State } from '../shared/protocol.ts'

const queued = new Map<string, { timer: NodeJS.Timeout; json: string }>()

/** Local calendar date, so a late party files under the evening it started. */
function dateOf(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function write(path: string, dir: string): void {
  const entry = queued.get(path)
  if (!entry) return
  clearTimeout(entry.timer)
  queued.delete(path)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, entry.json)
  } catch (err) {
    console.error('[nights] could not write the keepsake:', err)
  }
}

/** The finale's keepsake, coalesced like `saveState`: a burst of changes writes once, with the latest. */
export function saveNight(dir: string, state: State, now = new Date()): void {
  const date = dateOf(now)
  const path = join(dir, `${date}.json`)
  const json = JSON.stringify(nightKeepsake(state, date), null, 2)
  const entry = queued.get(path)
  if (entry) {
    entry.json = json
    return
  }
  const timer = setTimeout(() => write(path, dir), 100)
  timer.unref?.()
  queued.set(path, { timer, json })
}

/** Write anything outstanding right now; sync so shutdown cannot wait on it. */
export function flushNights(): void {
  for (const path of [...queued.keys()]) write(path, dirname(path))
}

export { dateOf as nightDate }
