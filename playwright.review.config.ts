import { defineConfig } from '@playwright/test'
import { createHash } from 'node:crypto'
import { availableParallelism } from 'node:os'

const port = Number(process.env.REVIEW_PORT ?? 4200 + createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 800)
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tools/review',
  testMatch: '*.spec.ts',
  workers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))),
  use: { baseURL: origin },
  webServer: {
    command: `npx vite --config vite.review.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/review.html`,
    reuseExistingServer: false,
  },
})
