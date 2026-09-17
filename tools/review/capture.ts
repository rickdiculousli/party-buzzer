import { chromium } from '@playwright/test'
import { join } from 'node:path'
import type { Annotation } from '../../client/review/model.ts'

type Mark = { label: number; targetId: string }

/**
 * Number each suggestion on the shot it belongs to. The workbench's own bounds
 * are in its fluid iframe's pixels, so the target is found again here and
 * measured at the capture viewport. An id that is missing or repeated is left
 * unmarked rather than boxed around the wrong thing.
 */
function outline(marks: Mark[]) {
  for (const mark of marks) {
    const found = document.querySelectorAll(`[data-review-id="${CSS.escape(mark.targetId)}"]`)
    if (found.length !== 1) continue
    const rect = found[0].getBoundingClientRect()
    const box = document.createElement('div')
    box.style.cssText = [
      'position:fixed', `left:${rect.left}px`, `top:${rect.top}px`,
      `width:${rect.width}px`, `height:${rect.height}px`,
      'border:2px solid #00e5ff', 'box-shadow:0 0 0 1px #0b0a08',
      'z-index:2147483646', 'pointer-events:none',
    ].join(';')
    const tag = document.createElement('span')
    tag.textContent = String(mark.label)
    tag.dataset.reviewMark = String(mark.label)
    tag.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'background:#00e5ff', 'color:#0b0a08',
      'font:700 12px/1 ui-monospace,monospace', 'padding:3px 5px',
    ].join(';')
    box.append(tag)
    document.body.append(box)
  }
}

export async function capturePreviews(
  baseUrl: string,
  annotations: Annotation[],
  outDir: string,
): Promise<Record<string, string>> {
  const browser = await chromium.launch({ headless: true })
  const captures: Record<string, string> = {}
  try {
    const groups = new Map<string, { note: Annotation; marks: Mark[] }>()
    annotations.forEach((note, index) => {
      const key = `${note.surface}:${note.scenarioId}:${note.playerId ?? ''}`
      const group = groups.get(key) ?? { note, marks: [] }
      if (note.targetId) group.marks.push({ label: index + 1, targetId: note.targetId })
      groups.set(key, group)
    })
    for (const [key, { note, marks }] of groups) {
      const viewport = note.surface === 'board'
        ? { width: 1280, height: 720 }
        : { width: 390, height: 844 }
      const page = await browser.newPage({ viewport })
      const url = new URL('/review-frame.html', baseUrl)
      url.searchParams.set('scenario', note.scenarioId)
      url.searchParams.set('surface', note.surface)
      if (note.playerId) url.searchParams.set('player', note.playerId)
      await page.goto(url.toString())
      // Wait on the attribute, not visibility: an ink pad collapses <html> to zero height.
      await page.locator('html[data-review-ready]').waitFor({ state: 'attached' })
      const ready = await page.evaluate(() => ({
        state: document.documentElement.dataset.reviewReady,
        text: (document.body.textContent ?? '').trim().slice(0, 200),
      }))
      if (ready.state !== 'true') throw new Error(`preview ${key} failed to render: ${ready.text}`)
      await page.evaluate(({ x, y }) => scrollTo(x, y), note.scroll)
      await page.evaluate(outline, marks)
      const filename = `${note.surface}-${note.scenarioId}${note.playerId ? `-${note.playerId}` : ''}.png`
      await page.screenshot({ path: join(outDir, filename) })
      captures[key] = filename
      await page.close()
    }
  } finally {
    await browser.close()
  }
  return captures
}
