import { test, expect } from '@playwright/test'
import { makeReviewScenarios } from './fixtures.ts'

/**
 * Every surface is one screen: the board is a wall and a phone is a buzzer in a
 * hand, and neither may scroll. Each review scenario is loaded on the board and
 * on every phone at a few real screen sizes, and any page that overflows its
 * viewport in either direction fails, all of them reported at once.
 *
 * ponytail: covers the states the review deck has fixtures for; a new screen
 * needs a scenario before this can see it.
 */

/**
 * Scenarios that overflow today, each a layout still to fix. Checked both
 * ways: one that starts fitting fails the test until it leaves this list, so
 * the list only ever shrinks.
 */
const KNOWN = new Set([
  // 2px at 360x560 on every phone.
  'duel',
  // The Ink board is a two-column list of eight rows a side, ~1260px tall;
  // some Ink phones spill too (the prompt offer, even at 390x844).
  'ink-choosing', 'ink-choose', 'ink-offer', 'ink-keep', 'ink-clue',
  'ink-clue-stopped', 'ink-guess', 'ink-guess-missed', 'ink-peek', 'ink-over',
])

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

test('no board or phone preview scrolls at any tested size', async ({ page }) => {
  test.setTimeout(300_000)
  const overflows: string[] = []
  const stillOver = new Set<string>()
  for (const scenario of makeReviewScenarios()) {
    const targets = [
      { surface: 'board' as const, player: undefined },
      ...scenario.phones.map((p) => ({ surface: 'phone' as const, player: p.playerId })),
    ]
    for (const { surface, player } of targets) {
      for (const size of SIZES[surface]) {
        await page.setViewportSize(size)
        const url = new URLSearchParams({ scenario: scenario.id, surface, ...(player && { player }) })
        await page.goto(`/review-frame.html?${url}`)
        await page.locator('html[data-review-ready]').waitFor({ state: 'attached' })
        const over = await page.evaluate(() => {
          const root = document.scrollingElement ?? document.documentElement
          return { y: root.scrollHeight - innerHeight, x: root.scrollWidth - innerWidth }
        })
        if (over.y > 0 || over.x > 0) {
          stillOver.add(scenario.id)
          if (KNOWN.has(scenario.id)) continue
          overflows.push(
            `${scenario.id} ${surface}${player ? `:${player}` : ''} @${size.width}x${size.height}: ` +
              `${over.y > 0 ? `${over.y}px down` : ''}${over.y > 0 && over.x > 0 ? ', ' : ''}${over.x > 0 ? `${over.x}px across` : ''}`,
          )
        }
      }
    }
  }
  expect(overflows).toEqual([])
  expect([...KNOWN].filter((id) => !stillOver.has(id)), 'these fit now; remove them from KNOWN').toEqual([])
})
