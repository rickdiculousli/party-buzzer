# Strudel background music — design

Date: 2026-09-12

The board plays live, generated background music written in
[Strudel](https://strudel.cc/). Each piece of music is a module: Strudel code
plus a table of parameters per wall moment. The music follows the same
semantic moments every surface already agrees on, changes on bar boundaries,
and runs live at all times so modules can be edited and heard immediately.
The host sets the music volume.

## Decisions

- Music plays on the board only. Phones and host play no music.
- Music is always live. There is no baked or pre-rendered path. Strudel's
  `renderPatternAudio` can add one later if a module ever needs it.
- Adaptation comes from `Moment` in `shared/wall.ts`. Modules do not read
  `State`, timers, or other continuous inputs.
- The board loads Strudel with a dynamic `import()`. Phones and host never
  download it.
- The workbench may fetch any Strudel sound from its remote hosts. The board
  plays only sounds vendored into `client/public/`, which keeps the
  no-runtime-fetch rule.
- The hand-tuned `welcome.ogg` bed stays in place as lobby music.
- The host controls one music volume. It covers the Strudel music and the
  welcome bed; it does not change one-shot cues.
- Strudel is AGPL-3.0-or-later. Adding it is a deliberate dependency decision
  for this private LAN project.

## Dependencies

| Package | Used by | Purpose |
| --- | --- | --- |
| `@strudel/web` | board, workbench | core, mini-notation, tonal, transpiler, webaudio output and synths |
| `@strudel/codemirror` | workbench only | the Strudel editor (`StrudelMirror`) with highlighting and pattern visuals |

`@strudel/repl`'s `<strudel-editor>` element is not used. Its built-in prebake
loads remote sample banks unconditionally; the workbench builds the same
editor from `StrudelMirror` with its own prebake.

## Modules

A module named `game` consists of:

- `client/music/game.strudel` — plain Strudel code, paste-compatible with
  strudel.cc apart from the `p()` helper. It sets its own tempo with `setcps`.
- `client/music/game.json` — data written by the workbench:

  ```json
  {
    "moments": {
      "buzz:open": { "energy": 0.6, "tension": 0.3 },
      "buzz:collecting": { "energy": 1, "tension": 1 }
    },
    "now": ["riser"],
    "sounds": ["gm_epiano1:0", "RolandTR909_bd", "sawtooth"]
  }
  ```

  `moments` maps a moment to parameter values. A moment absent from the table
  keeps the previous values. `now` lists parameters that apply immediately
  instead of on the next cycle. `sounds` is the recorded list of sounds the
  module played in the workbench (see Samples).

`client/music/index.ts` is the registry. It collects every module's code and
JSON with Vite's `import.meta.glob` (code as `?raw`), so adding a module is
adding its two files and nothing rewrites TypeScript. It also exports `trackFor(moment: Moment): string | null`,
which chooses the module for a moment. Initially `idle:welcome` returns `null`
and every other moment returns `game`. Minigames add their mappings here.
`trackFor` is an exhaustive switch, so a new `Moment` without a mapping fails
typecheck.

### The `p()` helper

Module code reads parameters through `p(name, fallback)`, which is
`ref(() => current[name] ?? fallback)`. Strudel evaluates a `ref` at query
time, so parameter changes alter the playing pattern without re-evaluating the
code. The player registers `p` into Strudel's eval scope. Fades and volume do
not go through `p`; they are gain nodes (see Player), so they also act on notes
already sounding.

## Player: `client/music.ts`

The player owns the Strudel runtime on the board. Its public surface:

- `setTrack(name: string | null)` — idempotent. Switches modules or stops.
- `setMoment(moment: Moment)` — idempotent. Looks up the current module's
  parameters for the moment.
- `setVolume(v: number)` — music volume, 0–1.

Behaviour:

- Strudel shares the `AudioContext` from `client/sound.ts` through superdough's
  `setAudioContext`, so the board's existing unlock gesture unlocks music too.
- `client/sound.ts` gains one music gain node, exported as `musicOut()`. The
  welcome bed connects through it, and `setVolume` sets its gain. Cues keep
  connecting to the destination directly.
- Superdough ends its graph in the `destinationGain` of the controller returned
  by `getSuperdoughAudioController()`. After init, the player reconnects that
  node from the destination to `musicOut()`, and uses its gain for module
  fades.
- On first `setTrack` with a name, the player imports Strudel, initialises it
  with a prebake that registers synths and the local sample manifest only, and
  then evaluates the module. If the import fails, the board plays no music and
  the game continues.
- Parameter changes are held as pending and swapped into `current` when the
  scheduler crosses the next cycle boundary. Parameters listed in `now` apply
  immediately.
- Switching modules ramps the fade gain to 0 over one cycle, hushes, evaluates
  the new module, and ramps it back to 1. Switching between the welcome bed
  and a Strudel module uses the bed's existing fade, so the two overlap. These
  durations are starting points to tune by ear.
- If a module fails to evaluate, the player logs the error and stays silent.
  It never throws into board rendering.
- A sound missing from the local manifest is silent and logs a console
  warning.

The cycle-boundary swap and parameter resolution are pure functions exported
for tests. Clock reads stay in the player.

## Board wiring

`client/Board.tsx` already starts and stops the welcome bed from the current
moment. The same effect calls `setTrack(trackFor(moment))` and
`setMoment(moment)`, and applies `state.musicVolume` with `setVolume`. The
board does not contain module names or parameter logic.

## Music volume

- `State` gains `musicVolume: number`, default `0.8`.
- The host sets it with a slider in `client/GameSettings.tsx`, sending a
  `setMusicVolume` message. The hub handles it on the `act` route alongside
  other non-game operations: it clamps to 0–1, updates state, and broadcasts.
  It is not a host action. It does not enter undo history, cancel timers, or
  produce an `actionResult`, because dragging a slider must not flood undo.
- `server/snapshot.ts` persists it in the durable snapshot and excludes it from
  undo snapshots. `loadState` restores a missing or invalid value to the
  default.
- Host and board receive it. Phones do not need it and `viewFor` omits it.

## Samples

Strudel's npm packages contain synthesizers only (oscillators, noise, FM,
ZZFX). Sample banks (drum machines, Dirt-Samples, VCSL, piano) and the 128
General MIDI soundfonts are hosted on `raw.githubusercontent.com` and
`felixroos.github.io/webaudiofontdata`.

**Workbench:** the workbench prebake registers the full remote index: the same
sample manifests and soundfonts strudel.cc uses. Only manifests load up front;
audio downloads the first time a pattern plays a sound.

**Recording:** the workbench wraps Strudel's output and records each distinct
sound that actually triggers: `s`, `bank`, and `n`, which for soundfonts names
the recording. Recording what plays covers sounds a pattern chooses
dynamically. Saving writes the list to the module's `sounds`.

**Vendoring:** `npm run music-vendor` (`tools/music-vendor.ts`) reads every
module's `sounds`, resolves each against the remote manifests, and downloads
exactly those files into `client/public/music/samples/`. It writes one local
manifest, `client/public/music/samples/strudel.json`, with local `_base` paths,
records sources and licences in `client/public/sounds/CREDITS.md`, and deletes
vendored files that no module references. The board prebake loads only this
manifest.

## Workbench

`npm run motion` gains a Music scenario:

- A module picker, and a button that creates a new module's two files from a
  stub.
- The `StrudelMirror` editor holding the module's code, with evaluate and stop
  shortcuts matching strudel.cc.
- A row of moment buttons. Clicking one applies that moment's parameters
  through the same player logic the board uses, including the cycle-boundary
  swap, so transitions are heard as the board will play them.
- The parameter table beside the editor, editable in place.
- A volume slider that drives `setVolume`.
- Save posts to `/__music/save` in `vite.config.ts`, following the
  `/__anim/save` pattern: it validates the payload before touching files, then
  writes `<name>.strudel` and `<name>.json`.

Evaluation errors show inline in the editor.

## Testing

`npm test` covers:

- Parameter resolution from a moment table, including absent moments keeping
  prior values, and the cycle-boundary swap with and without `now` parameters.
- Every module's `sounds` entries exist in the vendored manifest, so a module
  saved without vendoring fails.
- `music-vendor` manifest resolution and `_base` rewriting against a fake
  manifest, without network.
- `setMusicVolume` clamps, persists through the durable snapshot, is absent
  from undo, and is omitted from phone views.

Typecheck enforces that `trackFor` covers every `Moment`. Listening is
checked by hand in the workbench and on the board.

## Documentation

- `ARCHTECTURE.md`: rows for `client/music.ts`, `client/music/`, and
  `tools/music-vendor.ts`; music volume in the state notes.
- `README.md`: the music workbench and `npm run music-vendor`.
- `AGENTS.md`: board music plays vendored samples only; run
  `npm run music-vendor` after saving a module.

## Out of scope

- Baked or pre-rendered music.
- Music on phones or host.
- Continuous inputs to music (timers, buzz counts, bow tension).
- A separate volume for one-shot cues.
