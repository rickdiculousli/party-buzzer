import { test, expect } from '@playwright/test'

test('a frozen phone preview opens no socket, microphone, audio, or spoken request', async ({ page }) => {
  const sockets: string[] = []
  const spoken: string[] = []
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws') sockets.push(socket.url())
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/spoken') spoken.push(request.url())
  })
  await page.addInitScript(() => {
    const counts = { microphone: 0, audio: 0 }
    Object.defineProperty(window, '__reviewEffects', { value: counts })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          counts.microphone += 1
          throw new Error('review preview requested microphone access')
        },
      },
    })
    class ReviewAudioContext {
      constructor() { counts.audio += 1 }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: ReviewAudioContext })
  })

  await page.goto('/review-frame.html?scenario=leader-answering&surface=phone&player=ada')
  await expect(page.locator('[data-review-ready="true"]')).toBeVisible()
  const effects = await page.evaluate(() =>
    (window as unknown as { __reviewEffects: { microphone: number; audio: number } }).__reviewEffects,
  )
  expect(effects).toEqual({ microphone: 0, audio: 0 })
  expect(sockets).toEqual([])
  expect(spoken).toEqual([])
})

test('a disabled buzzer can be annotated and the note survives reload', async ({ page }) => {
  await page.goto('/review.html?scenario=rebound')
  const phone = page.frameLocator('iframe[title="Phone preview"]')
  const buzzer = phone.locator('.buzzer')
  await expect(buzzer).toBeVisible()
  const box = await buzzer.boundingBox()
  if (!box) throw new Error('phone buzzer has no bounds')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  const note = page.locator('textarea[aria-label="Suggestion 1"]')
  await expect(note).toBeVisible()
  await note.fill('Explain when this player can buzz again.')
  await page.reload()
  await expect(page.locator('textarea[aria-label="Suggestion 1"]')).toHaveValue(
    'Explain when this player can buzz again.',
  )
})

test('Send copies the batch handoff line when no agent queue is configured', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4174' })
  let submitted: {
    batchId: string
    threadId: string
    annotations: Array<{ text: string; targetId?: string }>
  } | undefined
  await page.route('**/__review/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ threadId: '', delivery: 'clipboard', batchRoot: '/repo/.review/batches' }),
    })
  })
  await page.route('**/__review/batches', async (route) => {
    submitted = route.request().postDataJSON() as typeof submitted
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ batchId: submitted?.batchId, status: 'submitted' }),
    })
  })
  await page.goto('/review.html?scenario=rebound')
  await expect(page.getByLabel('Codex conversation')).toHaveCount(0)
  const phone = page.frameLocator('iframe[title="Phone preview"]')
  const buzzer = phone.locator('.buzzer')
  await expect(buzzer).toBeVisible()
  const box = await buzzer.boundingBox()
  if (!box) throw new Error('phone buzzer has no bounds')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByLabel('Suggestion 1').fill('Keep the rebound instruction visible beside the buzzer.')
  await page.getByRole('button', { name: 'Send 1 note' }).click()

  await expect(page.getByRole('status')).toContainText('submitted')
  expect(submitted?.threadId).toBe('')
  const expected = `Review batch ${submitted?.batchId}. Read /repo/.review/batches/${submitted?.batchId}/request.md.`
  await expect(page.locator('.review__handoff')).toHaveValue(expected)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
})

test('Send posts the saved note to the exact conversation and Refresh remounts previews', async ({ page }) => {
  let submitted: {
    batchId: string
    threadId: string
    annotations: Array<{ text: string; targetId?: string }>
  } | undefined
  await page.route('**/__review/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ threadId: '', delivery: 'codex', batchRoot: '/repo/.review/batches' }),
    })
  })
  await page.route('**/__review/batches', async (route) => {
    submitted = route.request().postDataJSON() as typeof submitted
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ batchId: submitted?.batchId, status: 'ready' }),
    })
  })
  await page.goto('/review.html?scenario=rebound')
  const phone = page.frameLocator('iframe[title="Phone preview"]')
  const buzzer = phone.locator('.buzzer')
  await expect(buzzer).toBeVisible()
  const box = await buzzer.boundingBox()
  if (!box) throw new Error('phone buzzer has no bounds')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByLabel('Suggestion 1').fill('Keep the rebound instruction visible beside the buzzer.')
  await page.getByLabel('Codex conversation').fill('exact-thread-id')
  await page.getByRole('button', { name: 'Send 1 note' }).click()

  await expect(page.getByRole('status')).toContainText('ready')
  expect(submitted?.threadId).toBe('exact-thread-id')
  expect(submitted?.annotations).toHaveLength(1)
  expect(submitted?.annotations[0]).toMatchObject({
    text: 'Keep the rebound instruction visible beside the buzzer.',
    targetId: 'phone:buzzer',
  })
  await expect(page.locator('.review__handoff')).toHaveCount(0)

  const frame = page.locator('iframe[title="Phone preview"]')
  const before = await frame.getAttribute('src')
  await page.getByRole('button', { name: 'Refresh previews' }).click()
  await expect(frame).not.toHaveAttribute('src', before ?? '')
  await expect(page.getByLabel('Suggestion 1')).toHaveValue(
    'Keep the rebound instruction visible beside the buzzer.',
  )
})
