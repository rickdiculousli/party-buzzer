# Local fonts load with font-display: block

The board is read from across the room, and a flash of fallback type there reads as a glitch. The fonts are served locally from `client/public/fonts`, so they arrive almost at once, and blocking until they do costs nothing visible. Each `@font-face` therefore uses `font-display: block`, not `swap`.

Where: `client/tokens.css` (`@font-face` rules)
