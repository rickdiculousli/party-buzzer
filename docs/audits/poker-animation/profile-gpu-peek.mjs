/** npm run motion -- --host 127.0.0.1, then node this-file [label] [url].
 * Real phone stress component, synthetic rAF pointer moves at 393 CSS px / DPR 2.75.
 * Tracing CPU sums are NOT physical-device FPS; software WebGL may distort GPU cost.
 */
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const label = process.argv[2] ?? 'peek'
const base = process.argv[3] ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, args: process.env.POKER_GL ? [`--use-angle=${process.env.POKER_GL}`] : [] })
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 844 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true })
  const errors = [], warnings = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()) })
  await page.goto(`${base}/anim.html`)
  await page.evaluate(async scene => {
    const runtime = performance.getEntriesByType('resource').find(entry => /\/preact\.js(?:\?|$)/.test(entry.name))
    const { h, render } = await import(runtime.name)
    const { PokerStress } = await import(`/anim/${scene}.tsx`)
    render(null, document.getElementById('app'))
    const style = document.createElement('style')
    style.textContent = '.poker-stress {width:100%;padding:0} .poker-stress > label {display:none} .poker-stress__surface {height:100vh!important;margin:0}'
    document.head.append(style)
    render(h(PokerStress, { lead: true, surface: 'phone' }), document.getElementById('app'))
    window.peekProbe = { reads: 0, writes: 0, draws: 0, uploads: 0, events: [] }
    for (const [method, counter] of [['drawElements', 'draws'], ['texImage2D', 'uploads']]) {
      const original = WebGLRenderingContext.prototype[method]
      WebGLRenderingContext.prototype[method] = function (...args) { window.peekProbe[counter]++; return original.apply(this, args) }
    }
    const rect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () { window.peekProbe.reads++; return rect.call(this) }
    new MutationObserver(list => window.peekProbe.writes += list.length).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['style', 'class'], subtree: true })
    document.querySelector('.poker-phone__table').addEventListener('pointermove', e => window.peekProbe.events.push(e.timeStamp))
  }, process.env.POKER_SCENE ?? 'PokerStress')
  await page.waitForTimeout(800)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const box = await page.locator('.poker-peek-line').boundingBox()
  const x = box.x + box.width * .65, y = box.y - 70
  await page.mouse.move(x, box.y + 30); await page.mouse.down()
  await page.mouse.move(x, y, { steps: 6 }); await page.waitForTimeout(250)
  const results = []
  async function trace(name, action) {
    const events = [], collect = ({ value }) => events.push(...value)
    await page.evaluate(() => { window.peekProbe = { reads: 0, writes: 0, draws: 0, uploads: 0, events: [] } })
    cdp.on('Tracing.dataCollected', collect)
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc', transferMode: 'ReportEvents' })
    const timing = await action()
    const end = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.end'); await end
    cdp.off('Tracing.dataCollected', collect)
    const result = { name, timing, ...await page.evaluate(() => window.peekProbe) }
    for (const name of ['Paint', 'UpdateLayoutTree', 'Layout', 'FireAnimationFrame', 'RasterTask']) {
      const spans = events.filter(e => e.name === name && e.ph === 'X')
      result[name] = { count: spans.length, ms: +(spans.reduce((sum, e) => sum + (e.dur ?? 0), 0) / 1000).toFixed(2) }
    }
    results.push(result)
  }
  await trace('moving, 1.8 seconds', () => page.evaluate(async ({ x, y }) => {
    const table = document.querySelector('.poker-phone__table'), times = []
    await new Promise(resolve => {
      const begin = performance.now()
      const tick = t => {
        times.push(t)
        table.dispatchEvent(new PointerEvent('pointermove', { clientX: x + Math.sin((t - begin) / 300) * 15, clientY: y + Math.sin((t - begin) / 250) * 25, pointerId: 1, bubbles: true }))
        if (t - begin < 1800) requestAnimationFrame(tick); else resolve()
      }
      requestAnimationFrame(tick)
    })
    const intervals = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
    return { frames: times.length, medianMs: intervals[Math.floor(intervals.length * .5)], p95Ms: intervals[Math.floor(intervals.length * .95)], slowFrames: intervals.filter(t => t > 25).length }
  }, { x, y }))
  const owner = await page.locator('.poker-hole').getAttribute('class')
  await page.screenshot({ path: `/tmp/poker-${label}.png` })
  await page.waitForTimeout(200)
  await trace('stationary, 1 second', () => page.waitForTimeout(1000))
  await trace('release', async () => { await page.mouse.up(); await page.waitForTimeout(400) })
  for (const result of results) result.events = { count: result.events.length } // keep the report compact
  const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo')
  const gpu = { devices: system.gpu.devices, renderer: system.gpu.auxAttributes?.glRenderer }
  const report = { label, gpu, viewport: { width: 393, dpr: 2.75, cpuThrottle: 4 }, owner, errors, warnings, results }
  await writeFile(`/tmp/poker-${label}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await browser.close() }
