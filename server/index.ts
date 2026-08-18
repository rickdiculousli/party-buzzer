import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { WebSocketServer } from 'ws'
import { Hub, type Conn } from './hub.ts'
import { Reader } from './reader.ts'
import { loadState, saveState, flushSave } from './state.ts'
import { Judge, type Transcribe } from './judge.ts'
import { sttBinary, transcribe as sttTranscribe } from './stt.ts'
import { render as renderClip } from './speech.ts'
import { lanAddresses, pickAddress, banner, qrFor, qrSvg } from './net.ts'
import { certHost, ensureCert } from './cert.ts'
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
  /** Speech-to-text for the judge. Undefined builds the helper; null disables it. */
  transcribe?: Transcribe | null
  flowDir?: string
  /** Serve https so phones get a secure context. False keeps tests off the network. */
  tls?: boolean
} = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8080)
  const statePath = opts.statePath ?? join(ROOT, 'state.json')

  const packDir = opts.packDir ?? join(ROOT, 'packs')
  const flowDir = opts.flowDir ?? join(ROOT, 'flows')
  const state = loadState(statePath)
  const hub = new Hub(state, {
    revealMs: opts.revealMs,
    collectMs: opts.collectMs,
    packDir,
    flowDir,
    onChange: (s) => saveState(statePath, s),
  })

  let transcribe = opts.transcribe ?? undefined
  let realStt = false
  if (opts.transcribe === undefined) {
    const bin = await sttBinary(join(ROOT, 'server/stt'))
    if (bin) {
      transcribe = (wav) => sttTranscribe(bin, wav)
      realStt = true
    }
  }
  const judge = new Judge(hub, { transcribe })

  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), judge })
  hub.setReader(reader)
  // All three subscribers, now that all three exist: the snapshot, the
  // reader's waits, and the judge's window.
  hub.setOnChange((s) => {
    saveState(statePath, s)
    reader.onStateChange(s)
    judge.onStateChange()
  })

  // The first transcription pays the model load (seconds cold, ~180ms warm),
  // and game night is not when to discover that. One throwaway clip at boot
  // warms speechd; the clip caches like any other, so this costs once ever.
  if (realStt && transcribe) {
    const hear = transcribe
    void renderClip(join(packDir, '.cache'), 'Warming up.').then((clip) => {
      if (clip.durationMs > 0) return hear(clip.path)
      // No warm-up is no judge failure — the first real answer pays the load.
    }).catch(() => {})
  }

  let joinUrl = ''

  // Fetched before the server is built, because the certificate decides which
  // kind of server it is. Null means http: the room still plays, without a mic.
  const tls = (opts.tls ?? true) ? await ensureCert(join(ROOT, '.cert')) : null

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    if ((req.url ?? '').startsWith('/qr.svg')) {
      qrSvg(joinUrl).then(
        (svg) => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg),
        () => res.writeHead(500).end('qr failed'),
      )
      return
    }
    if (req.method === 'POST' && (req.url ?? '').startsWith('/answer')) {
      const player = new URL(req.url ?? '/', 'http://localhost').searchParams.get('player') ?? ''
      // text/plain is the transcript itself — probe's speak: step and tests.
      // Anything else is a recording to transcribe.
      const isText = (req.headers['content-type'] ?? '').startsWith('text/plain')
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= 2_000_000) chunks.push(c)
      })
      req.on('end', () => {
        // Six seconds of mono 16-bit WAV at 48kHz is 576KB; 2MB is generous.
        if (size > 2_000_000) {
          res.writeHead(413).end('too large')
          return
        }
        void judge.submit(player, Buffer.concat(chunks), isText).then((r) => {
          res.writeHead(r.ok ? 200 : 409, { 'content-type': 'application/json' })
          res.end(JSON.stringify(r))
        }, () => {
          res.writeHead(500).end('judge error')
        })
      })
      return
    }
    void serveStatic(req, res)
  }

  const http = tls ? createSecureServer(tls, onRequest) : createServer(onRequest)

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
  // The certificate is for `*.local-ip.sh`, so the hostname has to be the one
  // that resolves back to this address — the raw IP would not match it.
  joinUrl = tls
    ? `https://${certHost(host)}:${actualPort}`
    : `http://${host}:${actualPort}`

  return {
    url: joinUrl,
    /** The raw-IP url, which works whenever local-ip.sh's DNS does not. */
    fallbackUrl: `http${tls ? 's' : ''}://${host}:${actualPort}`,
    tls: !!tls,
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

  // What the hostname buys and what it costs, in two lines, because both matter
  // at the moment a phone will not join.
  if (server.tls) {
    console.log(`  Phones need this name, not the IP — it is what the certificate covers.`)
    console.log(`  If it will not resolve, ${server.fallbackUrl} still plays (no mic).\n`)
  } else {
    console.log(`  No certificate: serving http, so phones cannot use the microphone.`)
    console.log(`  Spoken answers need internet at startup to fetch one.\n`)
  }

  // The two screens the host always ends up opening by hand. NO_OPEN=1 for a
  // headless box, or when you are restarting the server every thirty seconds
  // and do not want two more tabs each time.
  if (!process.env.NO_OPEN) {
    const opener =
      process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open'
    // The join url rather than localhost: over https, `localhost` is not a name
    // the certificate covers, so the host's own two tabs would open onto a
    // warning interstitial.
    for (const path of ['/board', '/host'])
      spawn(opener, [`${server.url}${path}`], {
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
      })
        .on('error', () => {})
        .unref()
  }

  process.on('SIGINT', () => {
    void server.close().then(() => process.exit(0))
  })
}
