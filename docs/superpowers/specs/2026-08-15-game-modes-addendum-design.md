# Game modes addendum — the server reads, and phones can mirror

Date: 2026-08-15

An addendum to `2026-08-15-game-modes-design.md`. Two changes, both driven by
playing the thing: the question set becomes something you pick on the host
screen, and the phone can act as a second screen for the board.

Neither adds a game mode. Both change who owns the question loop.

## What changed since the original spec

The original spec put the reader in a CLI tool: `npm run read -- pack.txt`
owned the pack, spoke each fragment, and drove the round. That works, and it is
what shipped. Playing it exposes the problem: **the game loop lives in a
terminal while the judging lives in the browser.** The reader arms the round,
you score it on `/host`, the reader advances. Two surfaces drive one game, and
adding "pick the pack in the UI" to that shape means adding UI to steer a loop
that lives somewhere else.

The reader was a separate process for a reason that turned out not to hold. It
ran on the host's machine — the only box with both `say` and the server — so
the separation bought no deployment freedom. It was a boundary with nothing on
the other side of it.

### The invariant this drops

The original spec said the server never sees question content. That is now
false: the server owns the pack.

What it preserves is the property that mattered. **Only spoken fragments ever
enter `State`.** The pack sits in server memory and never reaches the snapshot,
so a player still cannot see a fragment before the voice reaches it. The
redaction rule in `viewFor` is unchanged; what changes is which process holds
the file.

## Part 1 — the reader moves into the server

New `server/reader.ts`. It owns the question loop that `tools/read.ts` owns
today, mutating through the same paths the `act` handler already uses
(`hub.ts:139-142`), so the wire effects are identical and the module still
never learns who drove it.

`tools/pack.ts` moves to `shared/pack.ts` — it is a pure parser and the server
needs it now. Its tests move with it, unchanged.

Packs live in `packs/*.txt` at the repo root; `tools/sample-pack.txt` moves
there. `State` gains `packs: string[]` — **filenames only**, enumerated at
startup and refreshed in the hub constructor alongside `games`.

### Pre-rendered speech

`say` renders to a file (`say -o clip.aiff`), and this is worth doing ahead of
time rather than speaking live.

Selecting a pack renders every fragment to disk before the first question. This
was verified, not assumed:

- Rendering runs at roughly realtime (a 2.7s clip took 2.8s wall) and
  parallelises cleanly — three clips in 3.2s wall against ~5s serial. A
  36-fragment pack is about 30s at parallelism 4, once.
- `afinfo` reports duration up front, so the host screen can show real progress
  through a question instead of a spinner.
- Clips cache under `packs/.cache/<hash>.aiff`, keyed by a hash of the fragment
  text and the voice. A pack read twice renders once, ever.

The payoff at read time is that a fragment starts instantly — no ~2.5s
synthesis pause between sentences — and that playback becomes a file you
control rather than a process you wait on.

### Playback, and what pause means

Playback is `afplay` as a child process. Pause is `SIGSTOP`, resume is
`SIGCONT`. This is a real pause, verified sample-accurate: stopping 1.0s into a
4.85s clip left exactly 3.81s to play after resume.

**Pause holds the audio and nothing else.** Buzzers stay live, and
`powerEndsAt` is untouched. This is deliberate — the reason to pause is usually
that someone in the room interrupted, and that is exactly when a buzz should
still land.

It also needs no mechanism. `powerEnds` sets `powerEndsAt = Date.now()` when
the act fires (`quizbowl.ts:53`), so the power signal is already tied to where
playback actually is. Pausing delays the boundary; it does not desynchronise
anything. Power stays a signal, not a timer, exactly as the original spec has
it.

The corollary is that the power boundary must stay **event-driven**. Known clip
durations make it tempting to schedule `powerEnds` ahead as an instant; that
would break under pause. Fire it when playback reaches the fragment boundary.

### Interaction with undo

The reader stamps the arm it is reading for and aborts if that stamp changes —
the same pattern effects already use. Without it, an undo mid-question leaves
the reader pushing fragments onto a round that no longer exists.

### Reading progress in `State`

`State` gains `reading?: { pack, qIndex, total, fragIndex, paused }`.

It rides the normal broadcast so the host screen can render it without a second
channel. It is **display-only**: the reader owns playback and reconciles from
its own loop, so an undo that restores a stale `reading` block corrects itself
on the next push rather than rewinding the audio.

### Host UI

A pack dropdown plus **Read** / **Pause** / **Stop**, and a progress line
(`Q3/12 · fragment 2/3`). These go with the play controls, not inside the
`<details>` — picking the question set is game night, not setup.

Render progress appears in the same place while a freshly selected pack is
being synthesised, because that is the one moment the host waits on the
machine.

### `tools/read.ts` is deleted

With the loop in the server, it is a second copy of the question loop. Probe
already has `act:` steps for pushing fragments and `powerEnds` by hand, which
covers the debugging the reader was otherwise the only way to do.

## Part 2 — phones mirror the board

One framework-level boolean, `mirrorFragments`, default **off**. Not a mode
option: the original spec established fragments as round-level and
mode-agnostic, and the toggle belongs at the level the data does.

- **Off** — `viewFor` strips `fragments` and `answer` exactly as it does now
  (`hub.ts:314-315`). Quizbowl behaviour, unchanged.
- **On** — `viewFor` stops stripping, and `Player.tsx` renders the fragments
  above the buzzer whenever they are present.

The phone is a second screen for people at the back or off-angle, so it shows
precisely what the board shows, at the same instant. No new mode surface and no
registry override — the same reasoning the original spec used for the board:
a default-surface feature, not a module override.

Quizbowl keeps this off. Reading a full sentence the moment it begins is a real
advantage over hearing it word by word, and that asymmetry is the whole reason
`viewFor` strips fragments in the first place. The toggle exists for casual
trivia nights where nobody is racing a power window.

## Error handling

- No `say` or no `afplay` on the box: fragments still push, silently, and the
  host screen says so once. Same graceful degradation the CLI reader had.
- A render that fails for one fragment does not sink the pack — that fragment
  plays silently and is named on the host screen.
- `packs/` missing or empty: the dropdown is empty and reading is unavailable.
  Nothing else changes; the room can still play a hand-driven round.
- Pack parse errors behave as they do today — name the line, skip the question,
  refuse a pack with zero valid questions.
- Selecting a pack mid-question is refused, like `setGame`.

## Testing

- `shared/pack.ts` keeps its existing tests, moved and otherwise untouched.
- New `node:test` coverage: the arm-stamp abort, `mirrorFragments` on and off
  in `viewFor`, pack enumeration, and the render cache key (same text and voice
  hits, changed text misses).
- Playback itself is not unit-tested — it is two signals and a child process.
  The reader's loop is tested with rendering and playback stubbed, which is
  where the logic actually lives.
- The existing quizbowl integration test passes untouched. That is the check
  that the in-process reader is wire-identical to the CLI one it replaces.

## Explicitly not here

- **Board-side playback.** Pre-rendered clips could be served over HTTP and
  played by the board, which would put the audio on the big screen's speakers.
  Deferred: it needs a client audio path and an answer for which device is the
  sound system.
- **Voice selection.** `say -v` is one flag and the cache key already includes
  the voice, so this is cheap to add later. Left out until someone wants it.
- **Pause that blocks buzzing**, and pause that waits for a sentence boundary.
  Both were considered and rejected above.
- **Word-level text reveal.** Fragment granularity is what the board has always
  shown.
- Everything the original spec deferred stays deferred — showdown, mid-session
  mode switching, `speechSynthesis` in the browser.
