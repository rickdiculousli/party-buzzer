# Poker GPU peek: high-level task outline

**Status:** Implemented on `feat/poker` on 2026-10-01. The user confirmed smooth,
fast and responsive peek motion on the Pixel; physical-device profiling was not performed. This is the original high-level outline; actual
code and [implementation results](../../audits/poker-animation/README.md#gpu-peek-implementation)
are the current reference.

Completed in three boundaries: generated real prints and baseline; whole-pair
GPU bands and gestures; removal of DOM slices, alpha padding/cache versions,
soft shadow, canvas-lifetime recovery and final grouped checks. No new dependency
or input prediction. Hardware ANGLE Metal comparison supports the representation;
software headless GL is a poor phone proxy. The user subsequently confirmed the physical-phone response; these tasks do not
need reimplementation.

**Goal:** Preserve the flexible-card peek and acceptable seams while making the
pair substantially more responsive on the user's Pixel 10a in Chrome.

**Architecture:** Replace the phone peek's repeated DOM slices with two textured
card meshes in one bounded GPU canvas, including their flat portions. Reuse the
current local gesture and shared gradual bend model. Preserve native deal,
showdown, throw, clocks and semantic table publication outside this boundary.

**Tech stack:** Existing Preact/TypeScript and motion workbench; a small direct
WebGL renderer is the proposed starting point. No engine/library dependency is
assumed. Choose the supported API and texture format during the prototype.

**Context/design basis:** [Rendering lessons and handoff](../../audits/poker-animation/rendering-handoff.md).
Current motion rules are in [docs/design.md](../../design.md#poker-motion-costs).

**Execution:** Continue inline, commit each substantial boundary, keep checks
light and grouped. Do not start implementation as part of the handoff-writing
request. Earlier prototypes that failed are recorded in the handoff; do not
repeat them without a new reason.

## 1. Establish the device baseline and prove the new representation

- [ ] Inspect the current `PokerPlayer`, `bendCard`, `PlayingCard` and motion
  scenarios; preserve the current eight-slice renderer as the comparison.
- [ ] Make the real phone motion scene's input/frame measurements reproducible.
  Separate touch event cadence, JS/rAF timing and rendering/presentation evidence.
  Avoid equating a steady JS clock with smooth presented frames.
- [ ] Prototype a small canvas with two cached prints and a shared deformable
  surface. Include flat portions, fractional placement, back orientation and
  depth separation. Temporary prints are acceptable only for this proof.
- [ ] Compare raster/main-thread cost and visible movement in mobile emulation,
  then on the actual Pixel when device access/user observation is available.
  Inspect the exposed underside and right contour at shallow/medium/deep lifts.
- [ ] Keep the renderer only if it materially improves response without returning
  leaks, tears or intrusive seams. Discard the prototype if it is another expensive
  layer arrangement. Record the result and commit the proven boundary.

**Result:** A validated rendering approach, not an unmeasured full integration.
This gate is about technical evidence, not an extra permission round.

## 2. Prepare faithful, reusable card textures

- [ ] Select a deterministic local asset-generation path based on the existing
  `PlayingCard` artwork, local font and tokens. A browser cannot directly upload
  an arbitrary HTML element to WebGL; avoid runtime screenshot/foreignObject
  tricks or a separate hand-maintained imitation of the deck.
- [ ] Produce the required faces and shared back with the peek indices, rounded
  alpha edges and clean texture padding. Choose individual images versus an atlas
  based on actual upload/memory behavior, not framework preference.
- [ ] Preload/decode/upload the active hand's textures before touch rendering.
  Keep uploads out of the animation loop. Bound retention and resolution; don't
  retain a full high-resolution deck on the GPU by default.
- [ ] Document regeneration when artwork/tokens change. Inspect representative
  ace, number and court cards, both ink colours and the back at phone resolution.
  Verify loading/failure behavior and commit this boundary.

**Result:** Matching printed surfaces that are painted/uploaded once and reused.

## 3. Build the bounded mesh renderer

- [ ] Put rendering/resource ownership in a small poker-specific client module
  (for example `client/poker-peek-renderer.ts`); keep pure bend geometry in its
  owning module. File names/interfaces remain implementation choices.
- [ ] Represent the whole pair as meshes. Transform both resting card poses into
  one crease/profile, retaining gradual curvature and fractional coordinates.
  Use one consistent projection; remove the separate flat/animated seam.
- [ ] Draw correct front/back textures, continuous angle-dependent lighting,
  rounded edges and a cheap soft shadow. Use physical separation/depth for the
  pair rather than copying the DOM slices' stacking rules into the new design.
- [ ] Reuse buffers, textures and programs. Bound canvas size/resolution, resize
  deliberately and handle context loss/resource disposal without losing gestures.
  Keep a simple fallback when GPU rendering is unavailable or not ready.
- [ ] Check shared deformation, tangent/projection and side/UV invariants with a
  few meaningful pure tests. Inspect art and occlusion in real motion scenarios;
  run typecheck/build at the boundary and commit.

**Result:** A renderer with stable lifetimes and small per-frame parameter updates.

## 4. Integrate the existing gesture and animation lifetimes

- [ ] Attach the canvas to the phone's card region while preserving hit targets,
  peek-line semantics and the existing gesture classification. The peek remains
  local and never waits for table frames.
- [ ] Define native/GPU ownership of the whole pair during peek and release. The
  changeover must not flash, double-draw, move an edge or reveal hidden cards.
  Preserve native deal, refused-fold restoration, throw retirement and showdown.
- [ ] Cancel stale work on hand/match changes, resize and unmount. Retain reduced
  motion behavior and accessible card semantics outside the decorative canvas.
- [ ] Only if measured touch cadence still causes jagged movement, add short,
  bounded interpolation/prediction. Check reversals, stopping and re-grabbing;
  avoid a laggy spring or a perpetual resting animation loop.
- [ ] Verify phone gestures and lifecycle transitions in the motion workbench
  and on the Pixel, run the boundary checks, then commit.

**Result:** The new renderer operates inside the existing phone flow with no
server/rules/publication changes.

## 5. Remove replaced machinery and finish

- [ ] Delete superseded slice cloning, polygon-mask updates and slice-specific
  shade/stacking CSS once replacement/fallback ownership is settled. Preserve
  geometry needed by the new renderer and behavior needed outside peek.
- [ ] Remove abandoned experiments and temporary switches. Don't keep parallel
  complex renderers merely to avoid cleaning up; make fallback scope deliberate.
- [ ] Update the design guide/audit with the actual renderer and measured results,
  including physical-device limits. Keep the phone stress scene a normal way to
  inspect gesture motion and pacing in future work.
- [ ] Run focused logic checks and final typecheck/build. Broaden to the project
  suite only if the final scope justifies it; no UI unit-test expansion or repeated
  full-suite loops. Finish with physical-phone gesture checks and one final review.
- [ ] Commit the completed boundary and report what improved, what was measured,
  and any unresolved device-specific behavior.

## Review focus

- Pixel performance versus merely steady headless rAF timings.
- Shared card curvature/depth, correct back orientation and transparency at edges.
- Flat/bent continuity and native/GPU handoff without rounding, flash or duplicate print.
- Texture readiness, memory/resolution bounds, context loss and resource cleanup.
- Stale hand/match work, reduced motion, gestures and stopping the resting loop.

## Original suggested fresh-session opening (historical)

> Read `docs/audits/poker-animation/rendering-handoff.md` and
> `docs/superpowers/plans/2026-10-01-poker-gpu-peek.md`, verify the current code,
> and continue the GPU peek work inline. Prototype and measure the new representation
> first, preserve the current card appearance and alignment, remove ineffective
> replaced fixes, commit at major boundaries, and keep checks light and grouped.
