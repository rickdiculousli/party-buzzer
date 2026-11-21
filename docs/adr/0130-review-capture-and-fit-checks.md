# Review capture and fit checks measure the real frame, one page at a time

The review workbench's capture and layout checks load `/review-frame.html` in Chromium and measure what actually renders.

- Capture finds each annotated target again by `data-review-id` at the capture viewport, because the workbench's own bounds are in its fluid iframe's pixels. A target id that is missing or matches more than one element is left unmarked rather than boxed around the wrong thing.
- Readiness is the `html[data-review-ready]` attribute being attached, not visibility: an Ink pad collapses `<html>` to zero height, so a visibility wait stalls.
- `measure` in the fit check is passed to `page.evaluate`, so it is serialised into the browser and must stay self-contained (no closures over module values or imports).
- The fit check runs one test per scenario and surface, each on its own page, in parallel. A single page reused for the whole sweep crashes Chromium after about five hundred loads, and the run then hangs until timeout.
- `npm run test:review` starts its own dev server on a port derived from a hash of the checkout path (overridable with `REVIEW_PORT`), so fit checks in parallel worktrees never kill each other's server. Workers are a quarter of the machine's cores, at most four: past four the single dev server is the bottleneck.
- The review plugin's `/qr.svg` encodes `https://review.invalid/join`: the frozen board needs a QR of the production shape, but the workbench has no game server, so the code must not be joinable.

Where: `tools/review/capture.ts` (`outline`, `capturePreviews`), `tools/review/fits.spec.ts` (`measure`), `tools/review/plugin.ts` (`reviewPlugin`), `playwright.review.config.ts`
