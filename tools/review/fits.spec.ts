import { test, expect } from '@playwright/test'
import { makeReviewScenarios } from './fixtures.ts'

const SIZES = {
  board: [
    { width: 1280, height: 720 },
    { width: 1024, height: 600 },
  ],
  phone: [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 560 },
  ],
}

type Finding = { scroll: string | null; bounds: string[]; overlaps: string[] }

function measure(): Finding {
  const EPS = 0.5
  type Rect = { l: number; t: number; r: number; b: number }
  const name = (el: Element) => {
    const id = el.getAttribute('data-review-id')
    if (id) return id
    const cls = [...el.classList].filter((c) => !c.startsWith('fx-')).slice(0, 2).join('.')
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
  }
  const REPLACED = ['img', 'svg', 'canvas', 'input', 'button', 'select', 'textarea', 'video']
  const shows = (el: Element, cs: CSSStyleDeclaration) => {
    if (REPLACED.includes(el.tagName.toLowerCase())) return true
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true
    if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true
    const sides = ['top', 'right', 'bottom', 'left']
    if (sides.some((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 && cs.getPropertyValue(`border-${s}-style`) !== 'none')) return true
    return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '')
  }
  const visible = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
  const shown = (el: Element): Rect => {
    const b = el.getBoundingClientRect()
    let r = { l: b.left, t: b.top, r: b.right, b: b.bottom }
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const c = e.getBoundingClientRect()
      r = { l: Math.max(r.l, c.left), t: Math.max(r.t, c.top), r: Math.min(r.r, c.right), b: Math.min(r.b, c.bottom) }
    }
    return r
  }

  const boxes: { el: Element; r: Rect }[] = []
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-overlap], [aria-hidden="true"]')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'inline' || cs.display === 'contents') continue
    if (!shows(el, cs) || !visible(el)) continue
    const r = shown(el)
    if (r.r - r.l <= EPS || r.b - r.t <= EPS) continue
    boxes.push({ el, r })
  }

  const root = document.scrollingElement ?? document.documentElement
  const y = root.scrollHeight - innerHeight
  const x = root.scrollWidth - innerWidth
  const scroll = y > 0 || x > 0
    ? [y > 0 && `${y}px down`, x > 0 && `${x}px across`].filter(Boolean).join(', ')
    : null

  const bounds = boxes
    .filter(({ r }) => r.l < -EPS || r.t < -EPS || r.r > innerWidth + EPS || r.b > innerHeight + EPS)
    .map(({ el }) => name(el))

  const overlaps: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.r, b.r.r) - Math.max(a.r.l, b.r.l)
      const h = Math.min(a.r.b, b.r.b) - Math.max(a.r.t, b.r.t)
      if (w > EPS && h > EPS) overlaps.push(`${name(a.el)} × ${name(b.el)}`)
    }
  }
  return { scroll, bounds: [...new Set(bounds)], overlaps: [...new Set(overlaps)] }
}

test.describe.configure({ mode: 'parallel' })

for (const scenario of makeReviewScenarios()) {
  const targets = [
    { surface: 'board' as const, player: undefined },
    ...scenario.phones.map((p) => ({ surface: 'phone' as const, player: p.playerId })),
  ]
  for (const { surface, player } of targets) {
    test(`${scenario.id} ${surface}${player ? `:${player}` : ''} fits`, async ({ page }) => {
      for (const size of SIZES[surface]) {
        await page.setViewportSize(size)
        const url = new URLSearchParams({ scenario: scenario.id, surface, ...(player && { player }) })
        await page.goto(`/review-frame.html?${url}`)
        await page.locator('html[data-review-ready]').waitFor({ state: 'attached' })
        await page.addStyleTag({
          content: '*, *::before, *::after { animation-delay: -10s !important; animation-iteration-count: 1 !important; transition: none !important; }',
        })
        await page.waitForTimeout(30)
        const f = await page.evaluate(measure)
        const at = `@${size.width}x${size.height}`
        expect.soft(f.scroll, `the page scrolls ${at}`).toBeNull()
        expect.soft(f.bounds, `boxes leave the screen ${at}`).toEqual([])
        expect.soft(f.overlaps, `boxes overlap ${at}`).toEqual([])
      }
    })
  }
}
