import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Hub, type Conn } from './hub.ts'
import { Reader } from './reader.ts'
import { loadState, saveState, flushSave } from './state.ts'
import { lanAddresses, pickAddress, banner, qrFor, qrSvg } from './net.ts'
import type { ClientMsg } from '../shared/protocol.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/** Client routes are served the SPA shell; unknown files 404. */
const ROUTES = new Set(['/', '/host', '/board'])

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]
  const file = ROUTES.has(path) ? 'index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '')
  const full = join(DIST, file)

  // Refuse anything that escaped the dist directory.
  if (!full.startsWith(DIST)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] ?? 'application/octet-stream',
      // Only the hashed bundles may be cached, because only they change name
      // when they change content. Everything else in dist/ — fonts, the QR, the
      // sounds — keeps a stable filename, so a cached copy is a copy that never
      // updates: replacing a sound left every open board playing the old one
      // for an hour, which reads as a change that silently did nothing.
      'cache-control': full.includes('/assets/')
        ? 'max-age=31536000, immutable'
        : 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

export async function startServer(opts: {
  port?: number
  statePath?: string
  revealMs?: number
  collectMs?: number
  packDir?: string
} = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8080)
  const statePath = opts.statePath ?? join(ROOT, 'state.json')

  const packDir = opts.packDir ?? join(ROOT, 'packs')
  const state = loadState(statePath)
  const hub = new Hub(state, {
    revealMs: opts.revealMs,
    collectMs: opts.collectMs,
    packDir,
    onChange: (s) => saveState(statePath, s),
  })

  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache') })
  hub.setReader(reader)
  // Both subscribers, now that both exist: the snapshot and the reader's waits.
  hub.setOnChange((s) => {
    saveState(statePath, s)
    reader.onStateChange(s)
  })

  let joinUrl = ''

  const http = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/qr.svg')) {
      qrSvg(joinUrl).then(
        (svg) => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg),
        () => res.writeHead(500).end('qr failed'),
      )
      return
    }
    void serveStatic(req, res)
  })

  const wss = new WebSocketServer({ server: http, path: '/ws' })

  wss.on('connection', (socket) => {
    const conn: Conn = {
      id: crypto.randomUUID(),
      role: 'board',
      send: (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
      },
    }
    hub.add(conn)

    socket.on('message', (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        return // A malformed frame must never take the process down.
      }
      hub.handle(conn, msg)
    })

    socket.on('close', () => hub.remove(conn))
    socket.on('error', () => hub.remove(conn))
  })

  await new Promise<void>((resolve) => http.listen(port, '0.0.0.0', resolve))

  const actualPort = (http.address() as { port: number }).port
  const host = pickAddress(lanAddresses(), process.env.HOST_IP)
  joinUrl = `http://${host}:${actualPort}`

  return {
    url: joinUrl,
    port: actualPort,
    hub,
    close: async () => {
      for (const client of wss.clients) client.terminate()
      wss.close()
      // http.close() only stops new connections and waits for existing ones to
      // go idle, which an upgraded socket mid-teardown never does — shutdown
      // hangs instead of finishing. Drop them outright; the game is over.
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
      await flushSave()
    },
  }
}

// Only run the banner when launched directly, so tests can import cleanly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer()
  const candidates = lanAddresses()
  if (candidates.length > 1) {
    console.log(`  Multiple networks found: ${candidates.join(', ')}`)
    console.log(`  Using ${server.url}. Override with HOST_IP=<addr> npm start\n`)
  }
  console.log(banner(server.url, await qrFor(server.url)))

  process.on('SIGINT', () => {
    void server.close().then(() => process.exit(0))
  })
}
