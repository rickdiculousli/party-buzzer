# Cue layer editor: one shared axis, delta drags

The layer editor exists to combine sounds, so every layer of a cue is drawn on one shared time axis. Scaling each layer to its own length would make layers of different lengths incomparable.

- `span` is the last instant any layer is still sounding, recomputed from the recipe on every render. `Layers` widens the axis to a decoded file's audio end, so the gated tail past the envelope stays visible.
- `Track` draws the audio as two SVG paths, the part the envelope passes and the dimmed gated tail, instead of a rect per column, which keeps drags smooth.
- Handles move by the pointer delta from where the value started, never to an absolute position: a handle's x is the sum of every earlier stage, and an absolute read would jump it to the cursor.
- The clip's left edge (slide the audio, `head`) wins within `EDGE_PX` pixels and the body (move the layer, `delay`) takes the rest, as in Audacity. One `zoneAt` answers both hover and press, so the cursor cannot promise one gesture and the press deliver another. The zone is in client pixels because it is a pointing target.
- `setOver` re-renders only when the zone changes (Preact bails on an equal value), so the waveform is not rebuilt on every pointermove. Handles stop `pointermove` propagation so the svg's handler does not take their hint back.
- `setPath` refuses a path naming a layer that does not exist, so a stale dial cannot invent one, but lets through a field the layer omits, because the canvas draws all handles whatever the recipe declares.
- One cue is shown at a time, with no zoom, snapping or curve shaping; the harness speed slider covers short clicks beside long beds.

Where: `client/cues.ts` (`span`, `setPath`), `client/anim/Layers.tsx` (`Layers`, `audioEnd`), `client/anim/Track.tsx` (`Track`, `EDGE_PX`, `zoneAt`, `drag`)
