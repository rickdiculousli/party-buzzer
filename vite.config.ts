import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

const STYLE = fileURLToPath(new URL('./client/style.css', import.meta.url))
const OPEN = '/* anim:tunables'
const CLOSE = '/* /anim:tunables */'

/**
 * Lets the motion harness write its dialled-in values back into style.css.
 *
 * `configureServer` only runs under `vite dev`, so this endpoint cannot exist
 * in a build — there is no production path where a request rewrites a source
 * file. It also only ever replaces values between the `anim:tunables` markers,
 * matching each `--name:` line already there: an unknown property is refused
 * rather than appended, so a stale dial cannot quietly add dead CSS.
 */
function animSave(): Plugin {
  return {
    name: 'anim-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__anim/save', async (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { error: 'POST only' })

        try {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const values = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>

          const css = await readFile(STYLE, 'utf8')
          const start = css.indexOf(OPEN)
          const end = css.indexOf(CLOSE)
          if (start === -1 || end === -1) return reply(500, { error: 'markers missing' })

          const block = css.slice(start, end)
          let written = 0
          const patched = block.replace(
            /^(\s*)(--[\w-]+):\s*[^;]+;/gm,
            (line, indent: string, name: string) => {
              const v = values[name]
              if (v === undefined) return line
              written++
              return `${indent}${name}: ${v};`
            },
          )

          const unknown = Object.keys(values).filter((k) => !block.includes(`${k}:`))
          if (unknown.length) return reply(400, { error: `not in the block: ${unknown.join(', ')}` })

          await writeFile(STYLE, css.slice(0, start) + patched + css.slice(end))
          reply(200, { written })
        } catch (err) {
          reply(500, { error: (err as Error).message })
        }
      })
    },
  }
}

export default defineConfig({
  root: 'client',
  plugins: [preact(), animSave()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Only index.html. anim.html is a dev instrument and never ships — Vite
    // would otherwise pick up every HTML file in the root automatically.
    rollupOptions: { input: fileURLToPath(new URL('./client/index.html', import.meta.url)) },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/qr.svg': 'http://localhost:8080',
    },
  },
})
