# Minigame frame conventions

- Board frames carry a game's shared view; a phone's frame is that view plus its own private fields. A secret stays out of every frame that may not know it yet: Poker cards only once face up, Sketch's word at the reveal (sooner only for the drawer and anyone who guessed it), Phantom Ink's secret to writers until the game is over.
- A checkpoint's `data` may hold secrets (Poker's deck seed); views carry only its version and label.
- Heavy fields (Sketch `strokes`, Ink `pad`, Tank `cover`) are sent when they change and once a second, otherwise omitted, so a surface that missed a frame recovers within a second.
- Feed entries carry a rising `id` or `seq` (Poker feed, Sketch misses) so a surface animates each entry once and a trimmed feed still shows what is new.
- A Poker feed entry overloads `amount`: a bust carries its finishing place, a level its big blind.
- Ink and Sketch points are row-normalized and may overshoot the row within `INK_REACH`; the board clips them. Both ends round with `quantizePoint`, so a phone's own ink lands exactly where the server puts it.

Where: `shared/protocol.ts` (`MinigameFrame`, `PokerShared`, `PokerFeedEntry`, `SketchShared`, `InkShared`, `InkPrivate`, `MinigameCheckpoint`, `quantizePoint`, `INK_REACH`), `server/hub.ts` (`viewFor`), `server/minigames/`
