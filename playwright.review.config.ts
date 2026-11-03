import { defineConfig } from '@playwright/test'
import { createHash } from 'node:crypto'
import { availableParallelism } from 'node:os'

// A port per checkout, so fit checks in parallel worktrees don't kill each other's server.
const port = Number(process.env.REVIEW_PORT ?? 4200 + createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 800)
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tools/review',
  testMatch: '*.spec.ts',
  // A quarter of the box, at most four: past four the one dev server is the
  // bottleneck, and the rest of the machine stays free for other work.
  workers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))),
  use: { baseURL: origin },
  webServer: {
    command: `npx vite --config vite.review.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/review.html`,
    reuseExistingServer: false,
  },
})
