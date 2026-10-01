/** Regenerate local peek textures from PlayingCard, its stylesheet and local font.
 * Run `npm run poker:prints` after changing the artwork or card tokens.
 * The development-only print page is never a production build entry.
 */
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const output = fileURLToPath(new URL('../client/public/poker/prints/', import.meta.url))
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
await server.listen()
const scratch = await mkdtemp(join(tmpdir(), 'poker-prints-'))
const run = promisify(execFile)
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 252, height: 352 }, deviceScaleFactor: 3 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir(output, { recursive: true })
  const cards = [...'shdc'].flatMap((suit) => [...'A23456789TJQK'].map((rank) => rank + suit))
  for (const card of [...cards, 'back']) {
    const query = card === 'back' ? 'side=back' : `side=face&card=${card}`
    await page.goto(`${server.resolvedUrls!.local[0]}poker-prints.html?${query}`)
    await page.locator('#app[data-ready="true"]').waitFor()
    const png = await page.locator('.poker-card').screenshot({ omitBackground: true })
    const source = join(scratch, 'print.png')
    await writeFile(source, png)
    await run('cwebp', ['-quiet', '-lossless', '-z', '6', source, '-o', `${output}${card}.webp`])
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(`Generated ${cards.length} faces and one back at 756 × 1056.`)
} finally {
  await browser?.close()
  await server.close()
  await rm(scratch, { recursive: true, force: true })
}
