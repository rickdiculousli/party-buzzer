# HTTP and socket choices in the composition root

- Only hashed bundles under `dist/assets/` are cached (immutable). Fonts, the QR and sounds keep stable filenames, so they are served `no-cache`; caching one would leave open boards playing a replaced sound for an hour.
- `POST /spoken` caps the body at 2 MB; six seconds of mono 16-bit 48 kHz WAV is about 576 KB.
- A socket that vanished without closing looks open forever. The heartbeat pings each socket, and since page code cannot see a ping, each beat also sends a `beat` message so the browser knows the link is alive.
- On close, `http.close()` alone waits for connections to go idle, which an upgraded socket mid-teardown never does; `closeAllConnections()` drops them so shutdown finishes.

Where: `server/index.ts` (`serveStatic`, `startServer`)
