import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { reviewPlugin } from './tools/review/plugin.ts'

export default defineConfig({
  root: 'client',
  plugins: [preact(), reviewPlugin()],
})
