import { createReadStream, existsSync } from 'node:fs'
import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { ffmpegArgs, creditsRow, safeOut, safeRaw } from './tools/sndlib.ts'

const run = promisify(execFile)

const STYLE = fileURLToPath(new URL('./client/style.css', import.meta.url))
const OPEN = '/* anim:tunables'
const CLOSE = '/* /anim:tunables */'

const CUES = fileURLToPath(new URL('./client/cues.ts', import.meta.url))
const R_OPEN = '/* cue:recipes'
const R_CLOSE = '/* /cue:recipes */'

const RAW = fileURLToPath(new URL('./sounds/raw', import.meta.url))
const OUT = fileURLToPath(new URL('./client/public/sounds', import.meta.url))
const CREDITS = fileURLToPath(new URL('./client/public/sounds/CREDITS.md', import.meta.url))

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
          const { css: values = {}, recipes } = JSON.parse(
            Buffer.concat(chunks).toString(),
          ) as { css?: Record<string, string>; recipes?: unknown }

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

          // Everything that can refuse the save is checked before either file is
          // touched — half a save is worse than none, and the cue markers are
          // the one thing that could still fail after the CSS had landed.
          const rec = recipes && typeof recipes === 'object' ? recipes : null
          const src = rec ? await readFile(CUES, 'utf8') : ''
          const rs = src.indexOf(R_OPEN)
          const re = src.indexOf(R_CLOSE)
          if (rec && (rs === -1 || re === -1)) return reply(500, { error: 'cue markers missing' })

          await writeFile(STYLE, css.slice(0, start) + patched + css.slice(end))

          let cues = 0
          if (rec) {
            // Regenerated wholesale rather than line-matched: a recipe is a
            // tree, and there is no per-line identity to match against. Quoted
            // keys are valid TypeScript and the repo has no formatter to fight.
            const head = src.slice(0, rs)
            const marker = src.slice(rs, src.indexOf('*/', rs) + 2)
            const body =
              `\nexport const RECIPES = ${JSON.stringify(rec, null, 2)}` +
              ` satisfies Partial<Record<Cue, Recipe>>\n`
            await writeFile(CUES, head + marker + body + src.slice(re))
            cues = Object.keys(rec).length
          }
          reply(200, { written, cues })
        } catch (err) {
          reply(500, { error: (err as Error).message })
        }
      })
    },
  }
}

/**
 * Serves the holding ground to the harness.
 *
 * `apply: 'serve'` for the same reason `animSave` has it: there is no built
 * artefact in which any of this exists, so no production path reads a file off
 * the developer's disk by name.
 */
function sndLibrary(): Plugin {
  return {
    name: 'snd-library',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snd/library', async (_req, res) => {
        res.setHeader('content-type', 'application/json')
        try {
          const names = await readdir(RAW)
          const files = []
          for (const name of names) {
            if (!safeRaw(RAW, name)) continue
            const s = await stat(resolve(RAW, name))
            files.push({ name, size: s.size, mtime: s.mtimeMs })
          }
          files.sort((a, b) => b.mtime - a.mtime)
          res.end(JSON.stringify({ files }))
        } catch {
          // No holding ground yet is an empty library, not an error.
          res.end(JSON.stringify({ files: [] }))
        }
      })

      /**
       * What a layer is allowed to point at.
       *
       * Adopted files only, never the holding ground: anything a recipe names
       * has to be servable to the real board, or the harness will happily show
       * you a cue that goes silent in production. That has already happened
       * once on this codebase.
       */
      server.middlewares.use('/__snd/adopted', async (_req, res) => {
        res.setHeader('content-type', 'application/json')
        try {
          const names = await readdir(OUT)
          const files = []
          for (const name of names) {
            if (!safeOut(name)) continue
            const s = await stat(resolve(OUT, name))
            files.push({ name, size: s.size })
          }
          files.sort((a, b) => a.name.localeCompare(b.name))
          res.end(JSON.stringify({ files }))
        } catch {
          res.end(JSON.stringify({ files: [] }))
        }
      })

      server.middlewares.use('/__snd/raw', (req, res) => {
        // A malformed escape throws out of decodeURIComponent; a bad name is a
        // bad name however it got that way.
        let name = ''
        try {
          name = decodeURIComponent((req.url ?? '').split('?')[0].slice(1))
        } catch {}
        const full = safeRaw(RAW, name)
        if (!full) {
          res.statusCode = 400
          return res.end('bad name')
        }
        createReadStream(full)
          .on('error', () => {
            res.statusCode = 404
            res.end('not found')
          })
          .pipe(res)
      })

      server.middlewares.use('/__snd/adopt', async (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { error: 'POST only' })
        try {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const b = JSON.parse(Buffer.concat(chunks).toString())

          const input = safeRaw(RAW, String(b.name ?? ''))
          const out = safeOut(String(b.out ?? ''))
          if (!input) return reply(400, { error: 'no such raw file' })
          if (!out) return reply(400, { error: 'output must match [a-z0-9-]+.(wav|ogg)' })
          // `ffmpeg -y` overwrites, and the default placeholder in the panel is
          // the name of a shipped file. Adopting is not the moment to discover
          // you replaced one.
          if (!b.replace && existsSync(resolve(OUT, out)))
            return reply(409, { error: `${out} already exists — pick another name or delete it` })

          const args = ffmpegArgs({
            preset: b.preset === 'bed' ? 'bed' : 'one-shot',
            input,
            output: resolve(OUT, out),
            headMs: Number(b.headMs) || 0,
            cutMs: Number(b.cutMs) || 0,
            rate: Number(b.rate) || 1,
          })
          // A pathological input otherwise hangs the request with nothing in
          // the panel to say so.
          await run('ffmpeg', args, { timeout: 60_000 })

          const command = `ffmpeg ${args.join(' ')}`
          await appendFile(
            CREDITS,
            creditsRow({
              out,
              role: String(b.role ?? 'TODO — say what this is for'),
              source: basename(input),
              command,
            }),
          )
          reply(200, { command, out })
        } catch (err) {
          const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'ffmpeg is not on PATH'
            : (err as Error).message
          reply(500, { error: msg })
        }
      })
    },
  }
}

export default defineConfig({
  root: 'client',
  plugins: [preact(), animSave(), sndLibrary()],
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
