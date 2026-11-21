# `npm start` opens and closes its own browser tabs

When launched directly, the server opens `/board` and `/host`, the two screens the host always opens by hand; `NO_OPEN=1` skips this for a headless box or rapid restarts. It opens the join url, not `localhost`, because over https `localhost` is not covered by the certificate and the tabs would land on a warning page.

On Ctrl-C it closes every Chrome tab whose url starts with the server's url, matched by url because `open` never reports which tab it created (and a stale tab from an earlier run is just as dead). It is macOS and Chrome only, a no-op elsewhere.

- `pgrep` runs first, because `tell application` would launch Chrome just to close nothing.
- Tabs are walked backwards, because closing a tab renumbers the ones after it.
- Each step is killed after a timeout: an unresponsive Chrome may leave a tab, but Ctrl-C must exit.

Where: `server/index.ts` (`closeTabs`, the direct-launch block)
