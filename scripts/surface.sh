#!/bin/sh
# Screenshot one surface at one viewport for the `surface` routine kind:
#   sh scripts/surface.sh <path> <WxH>     e.g. sh scripts/surface.sh /host 1280x800
# Starts the server from this checkout on a free port (http, no speech helper,
# a throwaway state file), waits for it, shoots, and stops it. The PNG is
# shots/<path><size>.png with '/', 'x' and '×' as '_' (shots/_host1280_800.png).
set -eu
path=${1:?usage: surface.sh <path> <WxH>}
size=${2:?usage: surface.sh <path> <WxH>}
cd "$(dirname "$0")/.."
test -d node_modules/playwright || npm ci --no-audit --no-fund >/dev/null
test -f dist/index.html || npm run build >/dev/null
mkdir -p shots cache
out="shots/$(echo "$path$size" | tr '/×x' '___').png"
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
npx playwright screenshot --wait-for-timeout 2500 --viewport-size "$(echo "$size" | tr "x×" ",,")" "http://127.0.0.1:$port$path" "$out"
echo "$out"
