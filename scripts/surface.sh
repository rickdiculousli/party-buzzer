#!/bin/sh
# Screenshot one surface at one viewport for the `surface` routine kind:
#   sh scripts/surface.sh <path> <WxH>     e.g. sh scripts/surface.sh /host 1280x800
# Starts the server from this checkout on a free port (http, no speech helper, a
# throwaway state file), waits until the page has connected to it (no "Connecting"
# left on screen; a page that never connects fails the run), shoots, and stops it.
# The PNG is <SURFACE_DIR>/<path><size>.png with '/', 'x' and '×' as '_'
# (_host1280_800.png); SURFACE_DIR defaults to ~/.bmesh/shots/party-buzzer/<tree>
# (BMESH_TREE from the routine run, else "local"), outside every checkout, so a
# shot the daemon took on another box is found by tree. The path is printed last.
set -eu
path=${1:?usage: surface.sh <path> <WxH>}
size=${2:?usage: surface.sh <path> <WxH>}
cd "$(dirname "$0")/.."
if [ ! -d node_modules/playwright ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >/dev/null
fi
npm run build >/dev/null   # always: a stale dist/ would be shot against the current tree
dir=${SURFACE_DIR:-$HOME/.bmesh/shots/party-buzzer/${BMESH_TREE:-local}}
mkdir -p "$dir" cache
name=$(printf %s "$path$size" | sed 's/×/_/g; s/[\/x]/_/g')
out="$dir/$name.png"
viewport=$(printf %s "$size" | sed 's/×/,/; s/x/,/')
log=cache/surface-$$.log
state=cache/surface-$$.json
cleanup() { [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null; rm -f "$log" "$state"; }
trap cleanup EXIT INT TERM
node --input-type=module -e '
  const { startServer } = await import("./server/index.ts")
  const s = await startServer({ port: 0, tls: false, transcribe: null, statePath: process.argv[1] })
  console.log(`port ${s.port}`)
  process.on("SIGTERM", async () => { await s.close(); process.exit(0) })
' "$state" >"$log" 2>&1 &
pid=$!
port=""
for i in $(seq 1 100); do
  port=$(sed -n 's/^port \([0-9]*\)$/\1/p' "$log" | head -1)
  [ -n "$port" ] && break
  kill -0 "$pid" 2>/dev/null || { cat "$log" >&2; echo "surface: the server died" >&2; exit 1; }
  sleep 0.2
done
[ -n "$port" ] || { cat "$log" >&2; echo "surface: the server never listened" >&2; exit 1; }
node --input-type=module -e '
  const { chromium } = await import("playwright")
  const [url, out, viewport] = process.argv.slice(1)
  const [width, height] = viewport.split(",").map(Number)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(url)
    // The surfaces render "Connecting…" until their socket is up; a shot of that proves nothing.
    await page.waitForFunction(() => !/Connecting/.test(document.body.innerText), null, { timeout: 15000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: out })
  } finally {
    await browser.close()
  }
' "http://127.0.0.1:$port$path" "$out" "$viewport"
echo "$out"
