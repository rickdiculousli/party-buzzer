import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { startServer } from './index.ts'
import { BEAT_MISSES } from '../shared/protocol.ts'

test('a socket that stops answering pings is cut after the allowed misses; one that answers stays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-beat-'))
  const server = await startServer({
    port: 0, statePath: join(dir, 'state.json'), setlistDir: join(dir, 'setlists'), transcribe: null, tls: false, beatMs: 30,
  })
  try {
    const open = (name: string, autoPong: boolean) => new Promise<{ ws: WebSocket; beats: () => number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { autoPong })
      let beats = 0
      ws.on('message', (raw) => {
        if (JSON.parse(String(raw)).t === 'beat') beats++
      })
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'hello', role: 'player', playerId: name, name }))
        resolve({ ws, beats: () => beats })
      })
    })
    const gone = await open('gone', false)
    const here = await open('here', true)
    await new Promise((resolve) => gone.ws.on('close', resolve))
    assert.equal(gone.beats(), BEAT_MISSES)

    // Long enough for the answering socket to have been cut too, were its pongs not counted.
    await new Promise((resolve) => setTimeout(resolve, 30 * (BEAT_MISSES + 3)))
    const connected = (id: string) => server.hub.state.players.find((p) => p.id === id)?.connected
    assert.equal(connected('gone'), false)
    assert.equal(connected('here'), true)
    assert.equal(here.ws.readyState, WebSocket.OPEN)
    assert.ok(here.beats() > BEAT_MISSES)
    here.ws.close()
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
