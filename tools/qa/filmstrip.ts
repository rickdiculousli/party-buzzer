import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 5200 + Math.floor(Math.random() * 700)

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
if (args.includes('--list')) {
  const src = readFileSync(join(ROOT, 'client/anim/scenarios.tsx'), 'utf8')
  console.log([...src.matchAll(/^\s+id: '([^']+)'|Scenario\('([^']+)'|fx\('[^']+', '([^']+)'/gm)].map((m) => m[1] ?? m[2] ?? m[3]).join('\n'))
  process.exit(0)
}
const id = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!id) { console.error('usage: node tools/qa/filmstrip.ts <scenario-id> [--frames N | --at t1,t2,…] [--out dir]'); process.exit(2) }
const out = resolve(flag('out') ?? join(ROOT, '.qa', id))
mkdirSync(out, { recursive: true })

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' })
const base = `http://127.0.0.1:${PORT}`
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/anim.html`)).ok) break } catch {}
    if (i > 100) throw new Error('vite did not start')
    await new Promise((r) => setTimeout(r, 150))
  }
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    await page.addInitScript((scenario) => sessionStorage.setItem('anim:scenario', scenario), id)
    await page.goto(`${base}/anim.html`)
    const stage = page.locator('.harness__preview')
    await stage.waitFor()
    await page.waitForTimeout(900)
    const timing = await page.evaluate(() => {
      const root = document.querySelector('.harness__preview')!
      const runs = document.getAnimations().filter((a) => {
        const el = a.effect && 'target' in a.effect ? (a.effect as KeyframeEffect).target : null
        return el && root.contains(el)
      })
      for (const a of runs) a.pause()
      ;(window as unknown as { qaRuns: Animation[] }).qaRuns = runs
      return runs.map((a) => {
        const t = a.effect!.getComputedTiming()
        const el = (a.effect as KeyframeEffect).target as Element
        return { target: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, kind: a.constructor.name, delay: t.delay, duration: t.duration, endTime: t.endTime, easing: (a.effect as KeyframeEffect).getKeyframes()[0]?.easing ?? t.easing }
      })
    })
    if (!timing.length) throw new Error(`scenario ${id} mounted no animations on the stage`)
    const end = Math.max(...timing.map((t) => Number(t.endTime) || 0))
    const n = Number(flag('frames') ?? 12)
    const times = flag('at')?.split(',').map(Number) ?? Array.from({ length: n }, (_, i) => Math.round((end * i) / (n - 1)))
    const tight = stage.locator('.fx-stage > *').first()
    const shot = await tight.count() ? tight : stage
    const shots: { t: number; png: string }[] = []
    for (const t of times) {
      await page.evaluate((at) => {
        for (const a of (window as unknown as { qaRuns: Animation[] }).qaRuns) a.currentTime = at
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }, t)
      shots.push({ t, png: (await shot.screenshot()).toString('base64') })
    }
    writeFileSync(join(out, 'timing.json'), JSON.stringify({ scenario: id, endMs: end, frames: times, animations: timing }, null, 2))
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 400 } })
    await sheet.setContent(`<body style="margin:0;background:#111;color:#eee;font:14px ui-monospace,monospace">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px">
      ${shots.map((s, i) => `<figure style="margin:0"><img style="width:100%;display:block" src="data:image/png;base64,${s.png}"><figcaption>#${i + 1} t=${s.t}ms</figcaption></figure>`).join('')}
      </div></body>`)
    await sheet.screenshot({ path: join(out, 'sheet.png'), fullPage: true })
    console.log(`${join(out, 'sheet.png')}\n${join(out, 'timing.json')}  (${timing.length} animations, ${end.toFixed(0)}ms)`)
  } finally {
    await browser.close()
  }
} finally {
  vite.kill()
}
