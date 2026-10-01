# Peek card prints

Generated from `PlayingCard`, `client/style.css`, the prop tokens and the local
Big Shoulders Display font. These are lossless WebP files with rounded alpha
corners, all four peek indices, and no cast shadow or bend lighting.

Regenerate with `npm run poker:prints` after editing card art, print CSS, tokens
or the font. The command uses Playwright Chromium, a temporary local Vite server
and `cwebp` (install Chromium with `npx playwright install chromium`).

Logical print size is 252 × 352 CSS px, captured at 3× (756 × 1056). The renderer
loads/uploads only the active hand's two faces and the shared back, not the deck.
The print page is development-only and is not a production build entry.
