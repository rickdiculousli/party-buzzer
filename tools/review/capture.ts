import { chromium } from '@playwright/test'
import { join } from 'node:path'
import type { Annotation } from '../../client/review/model.ts'

export async function capturePreviews(
  baseUrl: string,
  annotations: Annotation[],
  outDir: string,
): Promise<Record<string, string>> {
  const browser = await chromium.launch({ headless: true })
  const captures: Record<string, string> = {}
  try {
    const groups = new Map<string, Annotation>()
    for (const note of annotations) {
      const key = `${note.surface}:${note.scenarioId}:${note.playerId ?? ''}`
      if (!groups.has(key)) groups.set(key, note)
    }
    for (const [key, note] of groups) {
      const viewport = note.surface === 'board'
        ? { width: 1280, height: 720 }
        : { width: 390, height: 844 }
      const page = await browser.newPage({ viewport })
      const url = new URL('/review-frame.html', baseUrl)
      url.searchParams.set('scenario', note.scenarioId)
      url.searchParams.set('surface', note.surface)
      if (note.playerId) url.searchParams.set('player', note.playerId)
      await page.goto(url.toString())
      await page.locator('html[data-review-ready="true"]').waitFor()
      await page.evaluate(({ x, y }) => scrollTo(x, y), note.scroll)
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
