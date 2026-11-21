# The motion harness tunes the real stylesheet against the frame a moment interrupts

The harness page (`/anim.html`, `npm run motion`) loads `client/style.css` unmodified, so its dials drive the exact rules the board runs; its own chrome lives in `client/anim/harness.css` and must never style the preview, or you would tune against something the board does not have. Scenarios mount the real component inside a stripped copy of its real container and never restate a duration or colour; dials set the real `anim:tunables` properties on a wrapper.

An entrance is judged against the frame it actually interrupts. A scenario renders twice: `render(lead)` with `lead` true is the board an instant before the moment, with everything already there sitting still and only the new thing missing; clearing `lead` is the moment. A blank lead frame would judge the effect against a void.

- The scene is never remounted to fire a take. Context stays mounted, so only the newly rendered subject animates, as on the board. Fixtures key list items by stable ids (marks by name, voters `v1`..`v6`) so exactly one new element mounts per take. A ghost element holds an emptied band open so the layout below does not jump between takes.
- `trigger` sets `lead` and schedules its own timeout imperatively. An effect watching `lead` wedges: a trigger arriving while `lead` is already true never re-runs it.
- A layout effect walks the stage's animations before paint. On a whole-scene mount it cancels every animation outside the scenario's `subject` selector (or its descendants), so the context settles instead of going off together.
- Subject animations are rewound to 0 before `playbackRate` is set, or the opening frames play at full speed. Animations already handled are tracked in a `WeakSet` and only get the new rate: rewinding one in flight restarts it, which at 0.1x re-fires settled marks.
- The picture reveal scene drives `RevealPicture` from an invisible CSS animation's `currentTime`, read every frame, so the filmstrip's stepped clock drives the mosaic exactly as it drives CSS.
- `.harness__note` is positioned absolutely over the stage and takes no row, so panel text uses `.harness__hint`. The sound list pins its grid column to `minmax(0, 1fr)`: a grid item's `min-width: auto` let one long filename widen the whole panel instead of ellipsising.

Where: `client/anim.html`, `client/anim/harness.css` (`.harness__note`, `.harness__hint`), `client/anim/main.tsx` (`Harness`, `trigger`, `LEAD_MS`, `handled`), `client/anim/scenarios.tsx` (`Scenario.subject`, `Scenario.render`, `Timeline`, `VOTERS`, `RevealScene`, the `leader` scenario's ghost), `client/style.css` (`anim:tunables`, `.sndlist`)
