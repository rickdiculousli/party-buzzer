import { defineConfig } from '@playwright/test'
import { availableParallelism } from 'node:os'

export default defineConfig({
  testDir: './tools/review',
  testMatch: '*.spec.ts',
  // A quarter of the box, at most four: past four the one dev server is the
  // bottleneck, and the rest of the machine stays free for other work.
  workers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))),
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'npm run review:serve',
    url: 'http://127.0.0.1:4174/review.html',
    reuseExistingServer: false,
  },
})
