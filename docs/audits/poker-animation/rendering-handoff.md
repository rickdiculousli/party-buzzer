# Poker “3D-adjacent” rendering: lessons and session handoff

Recorded 2026-10-01 on `feat/poker`, originally after `5680780`; GPU follow-up implemented later that day.

## Current implementation update

The GPU direction below is now implemented on `feat/poker`: real generated prints,
a bounded whole-pair mesh renderer and existing gesture integration. See
[implementation results](README.md#gpu-peek-implementation) and the updated
[task outline](../../superpowers/plans/2026-10-01-poker-gpu-peek.md).
`b620b7d` prepares prints/baseline; `b23257f` introduces the GPU pair; the final
boundary removes superseded slices and fixes retained-canvas lifecycle.

Current source: `client/poker-bend.ts`, `client/poker-peek-renderer.ts`,
`client/PokerPlayer.tsx`, `tools/poker-prints.ts` and generated local print assets.
`peelCard`, `bendCard`, slice cloning/masks/shade CSS and the old flap DOM are gone.
The historical source map and lessons below describe how we arrived here.

Local hardware-backed drag callback CPU decreased from ~143ms to ~22ms over
1.8 seconds; settled peeks perform zero GPU draws. The user confirmed the Pixel
peek is now smooth, fast and responsive; physical-device FPS has not been profiled. No touch prediction was added without cadence evidence. The fallback
is deliberately a flat reveal, rather than retaining a second complex bend engine.
The final review found and reproduced an early-refusal/retained-canvas context-loss
bug; ownership now follows the actual canvas, and connected canvases remain usable
when renderer resources are refreshed. Oblique print edges have transparent sampling
padding. The first soft ellipse avoided folded-shadow overdraw but remained too
inconspicuous on the phone; it was replaced with softly masked affine card
silhouettes, still entirely on the GPU. Subsequent user feedback exposed doubled
alpha and a detached gap: the masks now union before blending, start at contact,
and broaden their penumbra with lift. An explicitly requested adversarial critic
found the named static defects addressed after a softness correction, while
retaining the limitation that the cast is an affine approximation and stills
cannot establish physical-phone motion quality.

## Where the original investigation stopped

The initial poker animation sweep is implemented. The phone peek now resembles
flexible card stock: shared gradual curvature, continuous lighting, aligned
fractional geometry, and a soft shadow. The user accepts the remaining tiny
visual seam: **no intrusive leaks or tears**, but the gesture still feels more
sluggish and irregular than ordinary CSS animations.

The reported physical device is **Pixel 10a, Chrome**. We have not profiled or
controlled that physical device. Desktop headless Chromium and mobile emulation
have not reproduced the user's frame skipping. Do not describe their steady rAF
cadence as proof that the phone is smooth.

The next direction is a small GPU mesh renderer for the phone's card pair.
**It has not been implemented.** The [high-level task outline](../../superpowers/plans/2026-10-01-poker-gpu-peek.md)
records the proposed change. The current eight-slice renderer is the working
baseline, not the intended permanent rendering architecture.

User working preferences carry forward:

- Implement inline using judgment; commit at each substantial boundary.
- Keep tests light and group verification at boundaries. Getting this hobby
  project to a usable result matters more than exhaustive coverage.
- Inspect and remove ineffective previous fixes. Do not accumulate workaround
  layers just because each once sounded plausible.
- Preserve the material appearance and the now-acceptable seams while improving
  actual phone response. Prefer evidence from the reported device.
- This handoff request is documentation only; no GPU implementation began here.

## Start with these files

| File | Current responsibility |
| --- | --- |
| [Audit and measurements](README.md) | Original sweep, retained optimizations, limits of the measurements |
| [Design guide](../../design.md#poker-motion-costs) | Current motion/material conventions |
| [PokerPlayer.tsx](../../../client/PokerPlayer.tsx) | Phone gestures, cached geometry, direct peek rendering, deal/throw/showdown lifetimes |
| [poker.ts](../../../client/poker.ts) | Gesture rules, peek tip, `peelCard`, shared `bendCard` geometry and lighting |
| [poker.test.ts](../../../client/poker.test.ts) | Pure gesture, geometry, shared-surface, projection and tangent invariants |
| [PokerParts.tsx](../../../client/PokerParts.tsx) | Real card artwork, moving pieces, shadows and local shot clock |
| [PokerBoard.tsx](../../../client/PokerBoard.tsx) | Cached table paths, table effects and independent level clock |
| [toss.ts](../../../client/toss.ts) | Trajectories and bounded frame thinning |
| [style.css](../../../client/style.css) | Card print, 2D peek samples, shade and cached shadow footprint |
| [PokerStress.tsx](../../../client/anim/PokerStress.tsx) | Real table/phone surfaces driven by synthetic frames |
| [Manual checklist](../../manual-checklist.md) | Physical phone gesture, sound and multi-device checks |
| [Poker definition](../../../server/minigames/poker/definition.ts) | Semantic frame publication key |
| [Minigame runtime](../../../server/minigames/runtime.ts) | Simulation and publication ownership |

Read the repository's current `AGENTS.md`, `ARCHTECTURE.md` and `README.md` too.
Historical plans are context; inspect actual code and call sites before changing
an established boundary.

## Lessons from the initial rendering sweep

### Simulation, publication and display are different clocks

The generic minigame pump ran every 16ms and published poker even when no table
fact changed. Poker does not need a stream of identical table snapshots to make
its clocks or effects move.

Poker now opts into a semantic `frameKey`: actions/feed, phase, board, actor,
deadlines, blind-level timing and connection presence determine publication.
Refusals/no-ops stay quiet. Fresh role projections are sent on hello. Dropped
catch-up time still forces a deadline rebase. Other games retain their existing
simulation/publication behavior; the generic pump was not globally removed.

The phone peek is entirely local. Its lag is not waiting for a server action or
network packet. The ring, level readout and final-second cues also advance locally
between state pushes. Clock correction must rebase native animations when needed,
without restarting them on every local second.

### Retain expensive derivations for their actual lifetime

Deal paths had been rebuilt repeatedly, including paired-card derivations more
than once per seat/render. Cache paths by match/hand/layout facts, and reset that
memory deliberately when those identities change. Equal size measurements should
not force new UI state.

A peek measures its resting pair once. Pointer frames reuse that geometry and do
not read layout. It wakes for pointer changes, initial lift and release, then
sleeps while the finger rests. Hand changes, resize, unmount and disconnected
nodes must cancel stale work. A thrown pair finishes, retires its offscreen DOM,
and is restored if the matching fold is refused.

### Transform-friendly properties do not make the whole effect cheap

Moving inherited geometry variables had driven card blur shadows and chip
lighting gradients, causing repeated style/paint work. Moving cards now animate
actual transforms, turn surfaces and shade opacity. Shadow silhouettes are
prepainted and transformed/crossfaded; their blur stays fixed. Chip lighting is
frozen during motion. Corral derivation is retained, hidden/pending chips are
omitted, and meter fills/glows use transform/opacity.

Changing a variable high in a subtree can be much more expensive than changing
one leaf. The later peek's inherited lighting gradient caused style work through
all cloned card descendants. Applying the identical gradient directly to the
shade leaves cut style CPU by roughly 84–85% in a throttled comparison. This
helped, but did not fix the user's physical-device sluggishness. Read lamp and
material tunables from the actual card/scene scope: motion workbench overrides
need not live on the document root.

### Let the browser interpolate, within meaningful error bounds

Sampled travel paths are thinned before native animation upload. Preserve contact,
pause, tap, stacking and turn landmarks exactly; approximate between them within
explicit position/rotation/lift/turn tolerances. Do not simplify important events
just because the endpoints still match. Native stacking steps belong to each
keyframe segment, not an effect-level step that delays all changes until the end.

### Optimize the demonstrated cost

The original prop sweep found large paint reductions from changing moving
lighting/shadows. It did not find enough evidence to replace the static felt or
finite celebration effects. Later isolation of the curved peek also found little
benefit from removing felt. Keep the visual world unless its actual cost warrants
changing it.

## Lessons from making the peek bend like card stock

### A reflected polygon is a fold, not elevation

The first peek reflected a flat triangular flap over a straight crease. A highlight
on that flap could suggest bending but could not supply a rounded silhouette,
compressed print, gradual surface orientation or credible separation from cloth.

The current model maps material distance behind a crease to projected displacement
and elevation. Curvature eases into and out of the bend, then continues as a raised
plane. Lighting follows the surface angle. This material model is reusable for a
GPU renderer; the repeated DOM slices are not essential to it.

### Both cards must use one surface

Sharing only the crease was insufficient. Independent exposed depths produced
independent radii and sample locations, so one card rounded before the other and
intersected it. Both cards now share the crease, bend extent/profile and sample
boundaries in screen space. Local rest rotations are coordinate transforms into
that same surface.

The stack also changes which side covers which through the turn. The DOM renderer
handles that per sample. A mesh should represent a small physical separation and
use depth, rather than carry over the slice-specific stacking workaround blindly.

### Printed sides and projected sides must agree

A switch based on the unprojected bend angle was wrong once simulated elevation
changed the apparent edge-on point. Current side selection follows the projected
matrix winding: a negative determinant exposes the back in the mirrored face
coordinate system.

The usual card component's additional 3D flip/backface handling could expose the
opposite print inside an already-projected 2D sample. Peek samples now draw only
the selected side, without that second flip. The back print also needs its own
horizontal mirror undone so its pattern meets the resting back's orientation.

These are separate concerns: physical side, texture orientation and screen
projection. A new renderer must handle all three explicitly.

### Precision at the seam matters more than adding concealment

`offsetWidth`, `offsetHeight`, `offsetLeft` and `offsetTop` round to integers.
Actual phone card sizes and placement are fractional. At 390 CSS px, for example,
a card was about 226.188px wide while the bend used 226px; the tilted card's top
placement differed by about 0.2px. That is enough to expose a tiny sideways step
or a sliver at high device pixel density.

Cache fractional dimensions and placement, and use the same geometry for printed
surfaces and their deformation. Preserve this in any renderer replacement.

A contact tangent also needs sufficiently gradual curvature and sampling. Coarse
first segments visibly changed direction at the flat-to-bent transition. Current
curvature has a gentle onset and fine initial samples. The existing small overlap
between samples continues across the tangent instead of stopping at it.

**The previous 0.8px expansion of the flat-card mask was removed.** It did not
resolve the exposed-underside problem and should not return as another cover-up.
The user repeatedly caught residual issues after screenshots had been called
fixed: check the exposed underside and far right contour at shallow/medium lifts,
not just the region concealed by the curved face during a deep peek.

Rendering the entire card, flat and bent, as one continuous mesh should remove
that separate flat/animated join altogether. It still needs an accurate surface,
correct texture orientation and fractional placement.

### Lighting continuity and geometry continuity are different

One solid shade per sample produced visible bands. A continuous gradient shared
in source-card coordinates smoothed the lighting while keeping print and edges
crisp. Blurring the entire card would have hidden detail rather than corrected
the lighting discontinuity.

Smooth shade does not make faceted geometry smooth. Likewise, a continuous mesh
can still have stepped lighting if its shader or normals are wrong.

## What the performance investigation actually established

The current renderer has eight samples per card: seven along the curve and one
raised plane. Samples are cloned lazily on first peek, retained for the hand,
and updated directly; Preact does not rerender the whole phone every pointer frame.
The soft cast shadow now scales/moves a prepainted radial footprint instead of
reclipping and blurring a moving polygon.

There is no intentional low-FPS cap. `requestAnimationFrame` coalesces pointer
updates. The 140ms lift easing only affects the start; it is not continuing
smoothing while dragging. A resting finger still generates no peek animation-loop
work. Input cadence/interpolation has **not** been demonstrated to be the remaining
physical-device cause.

| Observation | Evidence and limit |
| --- | --- |
| Initial prop paint improvements | Roughly 83–92% lower paint CPU for deal/flop/chip/pot probes; isolated headless scenes, not full-table or phone FPS |
| Stationary peek | Zero rAF callbacks, geometry reads and paints during measured resting windows |
| Leaf-level lighting | Style CPU about 395ms → 64ms over a 1.8s, 4× CPU-throttled drag; did not eliminate reported Pixel stutter |
| Lighter curved peek | Raster-task CPU about 717ms → 432ms and callback CPU 138ms → 107ms for a 1.8s drag at 393 CSS px, DPR 2.75, 4× CPU throttling |
| Edge alignment | Under 0.001 CSS px difference at tested right-edge contact points across several phone widths; does not guarantee all raster seams disappear |
| Headless cadence | Usually near 16.7ms rAF intervals before and after; not evidence of the physical Pixel's presented-frame rate |

Raster CPU values sum worker work over the observation window. They are not a
single-frame duration, and parallel work cannot simply be divided into a phone
FPS estimate. CPU throttling does not reproduce the Pixel GPU, compositor,
refresh policy, thermal state or actual touch delivery.

Discarded experiments:

- Cached face images inside the existing slices barely changed the cost.
- Replacing printed subtrees with flat images also gave insufficient benefit.
- Removing perspective/isolation from card wrappers did not meaningfully help.
- Fixed rectangular crops with inverse transforms were worse than polygon masks.
- Promoting those crops to GPU layers worsened raster work and produced skipped
  rAF intervals in the emulated check.
- Removing shade reduced paint cost but not enough raster cost to justify losing
  the material lighting. Removing the static felt did not help materially.

None of the cached-image assets, crop wrappers, experimental switches or layer
promotion rules remain in source. The useful winner was fewer slices plus the
prepainted shadow. Do not reintroduce failed experiments merely because “GPU
promotion” or “cached image” sounds inherently faster.

## Why a GPU mesh is the next direction

Changing clipped DOM appearance still requires repeated paint/raster work.
Compositor-friendly movement can skip those stages when existing pixels can be
reused; see [Chrome's rendering pipeline](https://developer.chrome.com/docs/chromium/renderingng-architecture).
A cached image alone did not fix the current representation because the slice
and clipping machinery remained.

The proposed change is to draw two cached card textures on deformable meshes in
one small canvas. Update crease/profile/pose parameters, deform the vertices,
shade the surface and handle overlap on the GPU. Keep the whole flat-and-bent
pair in that renderer during the gesture. This replaces the repeated DOM slice
representation, rather than promoting the same expensive layers.

Keep the canvas bounds and backing resolution deliberate, upload textures before
the gesture, reuse resources, and stop settled rendering. GPU work also has pixel
and memory budgets; see [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
No exact target FPS or physical-device improvement has been established yet.

The difficult parts are preparing faithful card textures without runtime DOM
snapshot tricks, retaining the artwork/fonts/rounded edges, correct back UVs,
continuous shared deformation and depth, clean native/GPU handoff, and matching
resolution to the real device. WebGL still needs JavaScript input/submission;
it is not automatically isolated from all main-thread stalls.

Measure actual touch and presented-frame behavior before adding prediction.
Short bounded interpolation may help uneven input; a long spring can look smooth
while making the card feel delayed. Do not run a perpetual clock while resting.

## Commit trail

| Boundary | Commit(s) |
| --- | --- |
| Initial lifetime, publication, paint and path work | `6e2af4c`, `081d2b9`, `6c0610f`, `04bb164` |
| First curved peek | `12214cc` |
| Shared profile and stacking | `fe71086` |
| Side selection / opposite-print bleed | `76f2c12` |
| Continuous shade | `db22299` |
| Flat-mask expansion, subsequently removed | `a17f6e1` |
| Underside orientation, tangent sampling and removal of expansion | `c2b1c8c` |
| Fractional geometry and gradual curvature | `53af076` |
| Lighting scoped to shade leaves | `76ffb61` |
| Eight samples and prepainted shadow | `5680780` |

Original measurement artifacts live in this audit directory. Later exploratory
scripts/screenshots under `/tmp` are temporary evidence, not durable dependencies.
The committed probes may need their local paths/Vite dependency hashes updated;
use the real motion scenarios rather than relying on an old temporary script.
