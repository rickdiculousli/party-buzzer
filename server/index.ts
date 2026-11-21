import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { WebSocketServer } from 'ws'
import { Hub, type Conn } from './hub.ts'
import { NEXT_CUE, Reader } from './reader.ts'
import { loadState, saveState, flushSave } from './state.ts'
import { flushNights, nightDate, saveNight } from './nights.ts'
import { nightKeepsake, setlistSpent } from '../shared/recap.ts'
import { Judge, type Transcribe } from './judge.ts'
import { transcribePool, sttBinary, transcribe as sttTranscribe } from './stt.ts'
import { locate } from './align.ts'
import type { Aligner } from './reader.ts'
import { render as renderClip, play as playClip, type Speech } from './speech.ts'
import { synthesize, timedFor, folds, takePath, HOUSE_VOICE } from './eleven.ts'
import { parsePools } from './quips.ts'
import { lanAddresses, pickAddress, banner, link, qrFor, qrSvg } from './net.ts'
import { PROVIDERS, certHost, ensureCert, type Tls } from './cert.ts'
import { BEAT_MISSES, BEAT_MS, type ClientMsg } from '../shared/protocol.ts'
import { MinigameRuntime } from './minigames/runtime.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BEAT = JSON.stringify({ t: 'beat' })
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
}

const ROUTES = new Set(['/', '/host', '/board', '/recap'])

const PACK_MEDIA = '/pack-media/'

async function serveStatic(req: IncomingMessage, res: ServerResponse, packDir: string): Promise<void> {
  let path: string
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0])
  } catch {
    res.writeHead(400).end('bad path')
    return
  }
  let root = DIST
  if (path.startsWith(PACK_MEDIA)) {
    root = packDir
    path = path.slice(PACK_MEDIA.length - 1)
  }
  const file = ROUTES.has(path) && root === DIST ? 'index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '')
  const full = join(root, file)

  if (!full.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(full)
    res.writeHead(200, {
      'content-type': TYPES[extname(full)] ?? 'application/octet-stream',
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
  beatMs?: number
  packDir?: string
  transcribe?: Transcribe | null
  setlistDir?: string
  tls?: boolean
  nightsDir?: string
} = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8080)
  const statePath = opts.statePath ?? join(ROOT, 'state.json')

  const packDir = opts.packDir ?? join(ROOT, 'packs')
  const setlistDir = opts.setlistDir ?? join(ROOT, 'setlists')
  const nightsDir = opts.nightsDir ?? join(ROOT, 'nights')
  const state = loadState(statePath)
  const hub = new Hub(state, {
    revealMs: opts.revealMs,
    collectMs: opts.collectMs,
    packDir,
    setlistDir,
    tracePath: process.env.TRACE ? 'trace.jsonl' : undefined,
    onChange: (s) => saveState(statePath, s),
  })
  const minigame = new MinigameRuntime(state, {
    onState: (cause) => hub.minigameChanged(cause),
    onFrame: () => hub.broadcastMinigame(),
    onAck: (playerId, ack) => hub.acknowledgeMinigame(playerId, ack),
    onComplete: (matchId, results) => hub.completeMinigame(matchId, results),
  })
  hub.setMinigameRuntime(minigame)
  const minigameTimer = setInterval(() => minigame.pump(), 16)
  minigameTimer.unref?.()

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

  const sttDir = join(ROOT, 'server/stt')
  const alignBin = realStt ? await sttBinary(sttDir) : null
  const sttAlign: Aligner | undefined = alignBin
    ? async (joined, clip) => {
        const pool = transcribePool(alignBin, clip.path)
        try {
          return await locate(joined, clip.durationMs, pool.transcribe)
        } finally {
          pool.close()
        }
      }
    : undefined

  const elevenKey = process.env.ELEVENLABS_API_KEY
  const elevenVoice =
    process.env.ELEVENLABS_VOICE_ID ?? (process.argv.includes('--eleven') ? HOUSE_VOICE : undefined)
  if (process.argv.includes('--eleven') && !elevenKey) console.warn('[speech] --eleven needs ELEVENLABS_API_KEY; using say')
  console.log(elevenKey && elevenVoice ? `[speech] ElevenLabs v4, voice ${elevenVoice}` : '[speech] say')
  const speech: Speech | undefined =
    elevenKey && elevenVoice
      ? {
          render: (dir, text, voice) =>
            synthesize(dir, text, elevenVoice, elevenKey).catch((e) => {
              console.warn(`[speech] elevenlabs failed, falling back to say — ${e}`)
              return renderClip(dir, text.replace(/\[[^\]]*\]\s*/g, ''), voice)
            }),
          play: playClip,
          cached: (dir, text) => existsSync(takePath(dir, text, elevenVoice)),
        }
      : undefined
  const poolsPath = join(packDir, 'quips', 'pools.txt')
  const align: Aligner | undefined = speech
    ? async (joined, clip) => {
        const timed = timedFor(clip.path)
        if (timed) return folds(joined, timed)
        return sttAlign ? sttAlign(joined, clip) : []
      }
    : sttAlign

  const reader = new Reader(hub, {
    packDir,
    cacheDir: join(packDir, '.cache'),
    speech,
    perform: !!speech,
    quips: speech && existsSync(poolsPath)
      ? parsePools(await readFile(poolsPath, 'utf8'))
      : undefined,
    judge,
    align,
    nextCardMs: 2000,
    nextCue: NEXT_CUE,
  })
  hub.setReader(reader)
  reader.priceUp()
  hub.setOnChange((s) => {
    saveState(statePath, s)
    if (setlistSpent(s)) saveNight(nightsDir, s)
    reader.onStateChange(s)
    judge.onStateChange()
  })

  if (realStt && transcribe) {
    const hear = transcribe
    void renderClip(join(packDir, '.cache'), 'Warming up.').then((clip) => {
      if (clip.durationMs > 0) return hear(clip.path)
    }).catch(() => {})
  }

  let joinUrl = ''

  let tls: Tls | null = null
  let provider = PROVIDERS[0]

  const bootId = crypto.randomUUID()

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/boot') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(bootId)
      return
    }
    if ((req.url ?? '').startsWith('/recap.json')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(nightKeepsake(state, nightDate(state))))
      return
    }
    if ((req.url ?? '').startsWith('/recap.svg')) {
      qrSvg(`${joinUrl}/recap`).then(
        (svg) => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg),
        () => res.writeHead(500).end('qr failed'),
      )
      return
    }
    if ((req.url ?? '').startsWith('/qr.svg')) {
      qrSvg(joinUrl).then(
        (svg) => res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg),
        () => res.writeHead(500).end('qr failed'),
      )
      return
    }
    if (req.method === 'POST' && (req.url ?? '').startsWith('/spoken')) {
      const player = new URL(req.url ?? '/', 'http://localhost').searchParams.get('player') ?? ''
      const isText = (req.headers['content-type'] ?? '').startsWith('text/plain')
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= 2_000_000) chunks.push(c)
      })
      req.on('end', () => {
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
    void serveStatic(req, res, packDir)
  }

  const listen = async () => {
    const server = tls ? createSecureServer(tls, onRequest) : createServer(onRequest)
    await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve))
    return server
  }
  const host = pickAddress(lanAddresses(), process.env.HOST_IP)
  let http: Awaited<ReturnType<typeof listen>> | null = null

  for (const p of (opts.tls ?? true) ? PROVIDERS : []) {
    tls = await ensureCert(join(ROOT, '.cert', p.domain), p)
    if (!tls) continue
    http = await listen()
    const url = `https://${certHost(host, p)}:${(http.address() as { port: number }).port}`
    try {
      const res = await fetch(`${url}/boot`, { signal: AbortSignal.timeout(5000) })
      if ((await res.text()) !== bootId) throw new Error('a different server answered')
      provider = p
      break
    } catch (err) {
      const e = err as Error & { cause?: Error }
      console.warn(`[cert] ${url} does not work (${e.cause?.message ?? e.message})`)
      http.closeAllConnections()
      const closing = http
      await new Promise<void>((resolve) => closing.close(() => resolve()))
      http = null
      tls = null
    }
  }
  if (!http) {
    if (opts.tls ?? true) console.warn('[cert] no working certificate; serving http')
    http = await listen()
  }

  const wss = new WebSocketServer({ server: http, path: '/ws' })

  const missed = new WeakMap<object, number>()
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const count = missed.get(socket) ?? 0
      if (count >= BEAT_MISSES) {
        socket.terminate()
        continue
      }
      missed.set(socket, count + 1)
      if (socket.readyState !== socket.OPEN) continue
      socket.ping()
      socket.send(BEAT)
    }
  }, opts.beatMs ?? BEAT_MS)

  wss.on('connection', (socket) => {
    socket.on('pong', () => missed.set(socket, 0))
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
        return
      }
      hub.handle(conn, msg)
    })

    socket.on('close', () => hub.remove(conn))
    socket.on('error', () => hub.remove(conn))
  })

  const actualPort = (http.address() as { port: number }).port
  joinUrl = tls
    ? `https://${certHost(host, provider)}:${actualPort}`
    : `http://${host}:${actualPort}`

  return {
    url: joinUrl,
    fallbackUrl: `http${tls ? 's' : ''}://${host}:${actualPort}`,
    tls: !!tls,
    port: actualPort,
    hub,
    close: async () => {
      clearInterval(minigameTimer)
      clearInterval(heartbeat)
      minigame.stop()
      for (const client of wss.clients) client.terminate()
      wss.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
      await flushSave()
      flushNights()
    },
  }
}

function closeTabs(url: string): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve()
  const lines = [
    'tell application "Google Chrome"',
    'repeat with w in windows',
    'set i to count of tabs of w',
    'repeat while i > 0',
    `if URL of tab i of w starts with ${JSON.stringify(url)} then close tab i of w`,
    'set i to i - 1',
    'end repeat',
    'end repeat',
    'end tell',
  ]
  const step = (cmd: string, args: string[]) =>
    new Promise<boolean>((resolve) => {
      const p = spawn(cmd, args, { stdio: 'ignore' })
      const t = setTimeout(() => p.kill('SIGKILL'), 1500)
      p.on('close', (code) => (clearTimeout(t), resolve(code === 0)))
      p.on('error', () => (clearTimeout(t), resolve(false)))
    })
  return step('pgrep', ['-qx', 'Google Chrome'])
    .then((running) => (running ? step('osascript', lines.flatMap((l) => ['-e', l])) : false))
    .then(() => {})
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer()
  const candidates = lanAddresses()
  if (candidates.length > 1) {
    console.log(`  Multiple networks found: ${candidates.join(', ')}`)
    console.log(`  Using ${link(server.url)}. Override with HOST_IP=<addr> npm start\n`)
  }
  console.log(banner(server.url, await qrFor(server.url)))

  if (server.tls) {
    console.log(`  Phones need this name, not the IP — it is what the certificate covers.`)
    console.log(`  If it will not resolve, ${link(server.fallbackUrl)} still plays (no mic).\n`)
  } else {
    console.log(`  No working certificate: serving http, so phones cannot use the microphone.`)
    console.log(`  Spoken answers need internet and local-ip.sh or local-ip.co at startup.\n`)
  }

  if (!process.env.NO_OPEN) {
    const opener =
      process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open'
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
    void closeTabs(server.url).then(() =>
      server.close().then(() => process.exit(0)),
    )
  })
}
