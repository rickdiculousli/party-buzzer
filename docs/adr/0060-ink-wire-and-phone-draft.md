# Phantom Ink: wire shapes and the phone's optimistic draft

- The writing pad is serialized straight to the wire, so `InkStroke` and `InkRow` are the view types (`InkStrokeView`, `InkRowView`) rather than a separate model to convert.
- The writing canvas sends the live stroke every 50 ms and commits on lift. Points are mapped through the SVG's screen matrix, which includes any CSS rotation of the sideways writing view, so they stay in row coordinates however the phone is held.
- The phone shows its own draft of the row until the server reports it has processed as many stroke and undo inputs as the phone sent (`InkDraft.sent` against `inkOps`). `inkOps` counts every input processed, accepted or refused, because counting only accepted ones would leave a refused stroke pending forever. A draft is dropped after `DRAFT_MS` if the server stops catching up.
- A draft allows undo only right after its own stroke (one undo per stroke); with no draft, the server's `canUndo` decides.
- Frames carry the pad only when it changed (and periodically), so `useInkPad` keeps the last full pad and resets it when the match changes.
- Typed guess letters use Plex Mono so every letter takes the same width and a guess is evenly spelled (the condensed display face leaves a hole beside an I and crowds an M); the pixel-grid filter (`#ink-px`) keeps it reading as the set's own lettering.
- The real deck (`packs/phantom-ink.txt`, transcribed from the owner's cards and gitignored) always wins. The sample deck (`packs/ink-sample.txt`) stands in only when `INK_SAMPLE=1` and the real deck is absent, for simulations, and announces itself once.

Where: `server/minigames/ink/types.ts` (`InkStroke`, `InkRow`, `InkWorld.inkOps`), `server/minigames/ink/cards.ts` (`loadInkDeck`, `INK_SAMPLE_PATH`), `client/ink.ts` (`InkDraft`, `liveDraft`, `draftCanUndo`, `DRAFT_MS`), `client/InkParts.tsx` (`InkCanvas`, `useInkPad`), `client/style.css` (`.ink-letter`)
