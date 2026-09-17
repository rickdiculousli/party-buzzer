import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tools/review',
  testMatch: '*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'npx vite --config vite.review.config.ts --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/review.html',
    reuseExistingServer: false,
  },
})
