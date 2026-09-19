import { test, expect, type Page } from '@playwright/test'
import { makeReviewScenarios } from './fixtures.ts'

/**
 * Every surface is one screen, laid out without collisions. Each review
 * scenario is loaded on the board and on every phone at a few real screen
 * sizes, with motion jumped to its end state, and three things must hold:
 *
 * - the page does not scroll;
 * - every visible box ends inside the viewport;
 * - no two visible boxes overlap, unless one contains the other.
 *
 * A box is an element that shows something on its own: text, an image, a
 * control, or a background, border or shadow. What an ancestor clips away (a
 * scrolling list, a well) counts only as far as it shows. A deliberate overlap
 * is marked in the markup with `data-overlap` and is exempt with everything
 * inside it; `aria-hidden` decoration (particles) is exempt too.
 *
 * ponytail: covers the states the review deck has fixtures for; a new screen
 * needs a scenario before this can see it.
 */

/**
 * Scenarios that break a rule today, each a layout still to fix, per rule.
 * Checked both ways: one that starts passing fails the test until it leaves
 * its list, so the lists only ever shrink.
 */
const INK = [
  'ink-choosing', 'ink-choose', 'ink-offer', 'ink-keep', 'ink-clue',
  'ink-clue-stopped', 'ink-guess', 'ink-guess-missed', 'ink-peek', 'ink-over',
]
const KNOWN_SCROLL = new Set([
  // 2px at 360x560 on every phone.
  'duel',
  // The Ink board is a two-column list of eight rows a side, ~1260px tall;
  // some Ink phones spill too (the prompt offer, even at 390x844).
  ...INK,
])
// Whatever scrolls has boxes past the screen's edge: the same two layouts.
const KNOWN_BOUNDS = new Set(KNOWN_SCROLL)
// Ink phones' prompt lists run over the rows and headings around them.
const KNOWN_OVERLAP = new Set(INK)

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

/** Measure one loaded page. Runs in the browser, so it must stay self-contained. */
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
  const visible = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false
    }
    return true
  }
  /** The rect as it actually shows: cut to every clipping ancestor. */
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
    if (r.r - r.l <= EPS || r.b - r.t <= EPS) continue // zero-size, or clipped away
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

type Sweep = Map<string, { where: string; f: Finding }[]>

async function sweep(page: Page): Promise<Sweep> {
  const out: Sweep = new Map()
  for (const scenario of makeReviewScenarios()) {
    const targets = [
      { surface: 'board' as const, player: undefined },
      ...scenario.phones.map((p) => ({ surface: 'phone' as const, player: p.playerId })),
    ]
    const found: { where: string; f: Finding }[] = []
    for (const { surface, player } of targets) {
      for (const size of SIZES[surface]) {
        await page.setViewportSize(size)
        const url = new URLSearchParams({ scenario: scenario.id, surface, ...(player && { player }) })
        await page.goto(`/review-frame.html?${url}`)
        await page.locator('html[data-review-ready]').waitFor({ state: 'attached' })
        // Every animation at its end state, so what is measured is where things land.
        await page.addStyleTag({
          content: '*, *::before, *::after { animation-delay: -10s !important; animation-iteration-count: 1 !important; transition: none !important; }',
        })
        await page.waitForTimeout(30)
        found.push({ where: `${surface}${player ? `:${player}` : ''} @${size.width}x${size.height}`, f: await page.evaluate(measure) })
      }
    }
    out.set(scenario.id, found)
  }
  return out
}

// One sweep, three verdicts: loading every page three times would triple a slow test.
let swept: Promise<Sweep> | undefined

function check(known: Set<string>, pick: (f: Finding) => string[]) {
  return async ({ page }: { page: Page }) => {
    test.setTimeout(600_000)
    swept ??= sweep(page)
    const failures: string[] = []
    const failing = new Set<string>()
    for (const [id, found] of await swept) {
      for (const { where, f } of found) {
        const hits = pick(f)
        if (!hits.length) continue
        failing.add(id)
        if (!known.has(id)) failures.push(...hits.map((h) => `${id} ${where}: ${h}`))
      }
    }
    expect(failures).toEqual([])
    expect([...known].filter((id) => !failing.has(id)), 'these pass now; remove them from the known list').toEqual([])
  }
}

test('no board or phone preview scrolls', check(KNOWN_SCROLL, (f) => (f.scroll ? [f.scroll] : [])))
test('every visible box sits inside the screen', check(KNOWN_BOUNDS, (f) => f.bounds))
test('no two visible boxes overlap', check(KNOWN_OVERLAP, (f) => f.overlaps))
