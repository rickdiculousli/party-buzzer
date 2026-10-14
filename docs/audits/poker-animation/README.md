# Poker animation sweep — 2026-09-30

Poker's largest opportunities are reducing redundant state-driven renders,
building each trajectory once, and separating object motion from expensive
lighting. The phone peek also has an unnecessary continuous loop after the
finger settles. The initial sweep was read-only; implementation results are
recorded in the follow-through section below.

## Evidence and limits

Inspected `PokerBoard.tsx`, `PokerPlayer.tsx`, `PokerParts.tsx`, `poker.ts`,
`toss.ts`, poker CSS/tokens, the interest kit, socket receipt, and the server's
runtime, projection and broadcast paths.

Ran `npm run motion -- --host 127.0.0.1` and used headless Chromium/CDP to profile
the real Deal, Flop, Showdown, Chips and Pot scenarios. Each measurement covers
two retriggers, with 2.5 seconds after each. Board viewport: 1920 × 1080;
phone viewport: 390 × 844. No CPU throttling. The small motion patch is
576 × 320 with 56px cards, so its timings do not represent a full TV table.

Also mounted the real board with an eight-seat synthetic frame, delivered
180 JSON-cloned frames at 16ms intervals, and mounted the real phone for
pointer-driven peek tests. These exercise components, not a live LAN match.
No room was mutated. Device battery, Safari, GPU raster time, dropped frames,
audio, reconnects and multi-device synchronization were not measured.

Raw measurements: [motion and board](motion-and-board.json), [peek](peek.json).
The diagnostic scripts are retained beside them. Their imports assume this
workspace and the current Vite dependency hash; they are evidence scripts,
not portable project commands. Scripts write temporary results under `/tmp`.

Paint counts below are Chrome trace records, **not full-screen redraw counts**.
CPU times are sums within each observation window, not frame duration or FPS.
Development-mode hooks and profiling add overhead.

## 1. Full state frames drive full-table renders — high priority

`server/index.ts:125` pumps the runtime every 16ms. Poker's simulation steps
every 50ms (`server/minigames/poker/table.ts:11`), but the playing branch of
`MinigameRuntime.pump` broadcasts on every pump, including pumps with zero
steps. `FRAME_MS = 50` only gates the countdown branch.

`Hub.broadcastMinigame` constructs a role frame for every connection. Poker's
projection rebuilds seats, pots and private legality; transport serializes the
result, and `useSocket.ts:154` accepts every fresh frame object as component
state. Tick and serverTime alone are enough to keep frames different.

In 180 identical synthetic deliveries, the board rendered 180 times, its
`Piece` components 3,780 times, and its 16 `PlayingCard` components 2,880 times.
The measured synchronous delivery/render loop took 282ms in total, including
JSON cloning and instrumentation. This proves redundant component work;
it does not prove that unchanged DOM was repainted 180 times.

**Recommendation:** first separate poker's changing clocks from its semantic
table updates. Then publish on visible changes, with a low-rate heartbeat if
needed. Preserve immediate action/presence/reaction updates and a fresh frame
on join. Keep the fixed-step game rules unchanged. A small definition-owned
publication policy is preferable to a poker branch in every surface.

Simply publishing at 20Hz would reduce traffic substantially, but a poker table
is usually unchanged for seconds and can do better. Avoid serializing the full
projection every pump merely to compare it with the previous one.

## 2. Deal and showdown trajectories are repeatedly rebuilt — high priority

At `PokerBoard.tsx:327`, `dealtTo(i)` creates both cards' pitches, collection
slides and taps. The card render loop calls it once for each card
(`PokerBoard.tsx:392`), so both trajectories are generated twice per seat.
`deal.current.at` stays set for the hand; this continues after the deal lands.
`Piece` only starts its animation on mount, so these replacement frame arrays
usually buy nothing.

Each `slide` solves speed with 60 bisection iterations and allocates frames at
16ms spacing. With eight seats, this render path builds 32 pitch paths and
32 collection paths per render. At the nominal publication cadence that is
roughly 4,000 slide constructions per second before folds and other effects.
Showdown similarly calls `turnUp` for the whole pair separately for each card,
then repeats that computation on subsequent frames.

**Recommendation:** compute each pair once and retain it for the hand. Cache
deal schedule, seat geometry and showdown pairs by the facts they depend on:
match, hand, dimensions, seat arrangement/button and relevant reveal transition.
Compute relative timing from one fixed deal origin, not repeatedly clamped
delays. Clear the cache on resize or hand/match change. Community-card moves
already demonstrate retaining a trajectory in a ref.

## 3. Moving lighting dominates paint — high priority, measured

`Piece` animates transform plus inherited `--piece-x/y/lift/rot/turn` properties.
Card descendants use them for trigonometry, blurred multi-layer box shadows
and turn shading. Chip descendants use them for conic/radial/linear gradients
and stack shadows (`style.css:2990–3189`). Interpolation happens in the browser,
but these paint-dependent properties still require style/paint work.

A diagnostic override fixed card/stack lighting inputs and card shade opacity
while retaining translation, rotation, scale and hinge flips. It is an
upper-bound experiment, not an adopted visual treatment:

| Scene | Paint CPU, current → fixed lighting | Style CPU, current → fixed lighting |
| --- | --- | --- |
| Deal | 66.0 → 1.8ms | 137.7 → 53.2ms |
| Flop | 72.8 → 5.2ms | 273.3 → 124.9ms |
| Showdown | 9.0 → 7.9ms | 59.9 → 76.0ms |
| Two chip stacks | 72.6 → 5.9ms | 109.9 → 27.8ms |
| Pot corral | 123.3 → 15.6ms | 202.2 → 73.6ms |

Deal, flop, chips and pot all show a strong lighting opportunity. Showdown's
style result did not improve in this pass; do not promise a win there.

**Useful cheats:**

- Keep chip edge/top illumination fixed during a push; change or crossfade it
  once at arrival. The object still moves convincingly.
- Give a moving card a separate, prepainted shadow layer. Animate its transform
  and opacity; crossfade tight contact and soft airborne shadows instead of
  animating blur/spread on both card faces.
- Animate hinge transforms directly on the turning element; animate shade
  opacity separately. Avoid propagating turn variables through the entire card
  subtree when only two small elements consume them.
- Bake a pot corral's chips and neighbour shadows into a stable moving group.
  Restore final lighting at rest. The current neighbour shading already uses
  the supplied endpoint rather than continuously recomputing in-flight geometry.

Do not add `will-change` to every card/chip. Many persistent layers can exchange
paint cost for memory/raster cost. Compare the appearance and memory on a phone
and the TV before adopting a shadow approximation.

## 4. Peek runs continuously when settled — medium priority, measured

`PokerPlayer.tsx:371–402` keeps scheduling rAF until release, even after the
140ms lift is complete and the finger is stationary. The two-second held-peek
sample ran 120 callbacks, consuming 28.1ms of callback CPU. It made 3,025
geometry reads, including 484 `getBoundingClientRect` calls. There were **zero
extra paints, layouts or style mutations** in that settled window.

The moving-pointer sample ran 61 callbacks, made 1,550 geometry reads and 232
style mutations, with 3.0ms of paint CPU and 11.7ms of callback CPU. It showed
no Layout events. Release caused two small layouts. Thus repeated reads are
real, but continuous forced reflow during movement was not demonstrated here.

**Recommendation:** capture both cards' dimensions, layout offsets, screen
centres and rotation matrices at gesture start. Calculate both cards' new folds
before applying either card's styles. Revalidate geometry on resize/layout
change. Stop rAF when lift finishes and no pointer change is pending; restart
on pointer movement and release. Preserve the shared crease and lower-card
outside flap—the effect's most convincing detail.

If more savings are needed, retain exact geometry while dragging, then use a
short sampled clip/matrix animation for the autonomous release. A fixed crease
angle or precomputed peel shapes is a more visible approximation and should
come after caching/sleeping the loop.

## 5. Fewer keyframes are possible, with explicit error bounds

The paths already use browser interpolation. The missing optimization is fewer
control points, not replacing a per-frame physics loop: there is no such loop
for board throws. One representative 72px-card pitch/receive path produced:

| Sampling | Frames | Maximum difference from 16ms samples |
| --- | --- | --- |
| 16ms | 80 | baseline |
| 32ms | 44 | 0.89px, 1.71°, 0.0032 lift |
| 48ms | 32 | 1.64px, 2.86°, 0.0046 lift |

This single path is not enough to change `TOSS.stepMs` globally. Prefer adaptive
simplification or phase-aware sampling: preserve release, touchdown, collection,
tap extrema, turn start/end and stacking transitions; thin the slow tail.
Use independent tolerances for translation, rotation, lift and turn. Keep exact
endpoints and test high-spin folds as well as ordinary deals. Cache first;
keyframe reduction is secondary once trajectories are only built once.

## 6. Clocks, static props and smaller effects

- **Shot ring:** `ShotRing` is recalculated from packet-driven `now()` on every
  table render. A deadline-based local animation can interpolate the ring,
  while text/accessible seconds and the final-five-second cues update locally
  at their required cadence. Isolate the HUD's next-level clock similarly.
  Otherwise reducing frame publication will freeze these displays and remove
  phone tick cues, which currently compare successive frames' serverTime.
- **Corral:** `topShades` is quadratic in stacks and sorting runs on every
  render. The stack count is bounded by `POT_SPOTS`, so this is secondary.
  Cache the shade/order result when pile composition and geometry are unchanged;
  stable props are needed before component memoization will help.
- **Stack DOM:** hidden held/pending chips retain full elements and their
  pseudo-elements. During pot gathers there are stationary and moving copies.
  A visible-range stack could omit hidden chips while retaining original height
  indices. Measure this before complicating landing bookkeeping.
- **Overbet:** a persistent box-shadow pulse (`style.css:3411`) paints repeatedly.
  A fixed glow layer animated by opacity, alongside the existing ripple, can
  preserve the warning cheaply. Meter fill transitions use width/left; switch
  to transform-based fills if slider interaction proves layout-heavy.
- **Felt:** full-table grain, masks and `PaintPile` turbulence are static. Do
  not assume they repaint just because Preact rerenders. Cache/static-layer
  isolation or locally baked texture assets become worthwhile only if traces
  show large-area raster invalidation. Keep the established cloth appearance.
- **Puck/lamp:** already move through CSS transforms; retain that approach.
- **Phone flick:** already uses two transform keyframes. Its forwards-filled
  animation and the offscreen pair remain until the next hand. Retiring the
  pair after flight could free layers sooner, with an explicit folded state
  preventing it from remounting and replaying its deal.
- **Folds/wins/reactions:** finite WAAPI/interest-kit effects are sensible.
  Fold linger does not run application rAF. `fx-poof` adds animated blur for
  200ms; consider opacity/scale alone only if simultaneous folds prove costly.

## 7. Lifecycle and validation constraints

Board banner/reaction timeouts and the phone's pending peek timer lack full
unmount cleanup. Give transient timers a small local cleanup path. A peek loop
that sees disconnected cards returns without clearing its runtime ref; clear
that state as well. These are bounded cleanup concerns, not evidence of an
unbounded rendering leak.

`Piece` deliberately uses a mount-only effect. Memoization must preserve its
identity and callbacks. Geometry changes need a deliberate policy: current
in-flight keyframes retain old dimensions while the rest pose updates. Avoid
accidentally replaying the whole deal to solve resize. Reduced-motion handling
already exists for Piece/deals/flips and CSS; the imperative peek and throw
paths need explicit consideration because CSS duration overrides do not alter
WAAPI/rAF durations.

Recommended implementation order:

1. Cache each seat's deal/showdown trajectories once and stop the settled peek.
2. Isolate local clocks/cues and reduce redundant poker publications/renders.
3. Prototype fixed chip lighting and separate card shadows in the motion kit.
4. Simplify sampled trajectories with bounded error; optimize static layers only
   if the remaining traces justify it.

Verify pure path simplification and stale-hand/match cleanup with focused tests.
Use the real motion scenarios for visual/timing changes, then the poker section
of `docs/manual-checklist.md` for phone gestures, sound and synchronization.
Include a full eight-seat deal/runout/gather in performance measurements:
isolated prop scenes do not show all simultaneous costs.

The smallest tooling improvement is a motion-workbench poker stress scenario
using the real table/phone components, with controllable duplicate frame cadence,
eight-seat deals and a pot gather. It would make this profiling path repeatable
without another ad hoc component mount. Frozen review previews cannot establish
animation performance or synchronization.


## Implementation follow-through

The recommendations are now implemented across four boundaries: cached paths
and gesture lifetimes; semantic poker publication and independent clocks;
composited prop lighting and lighter chip/meter rendering; bounded native path
interpolation. Match identity keys clear browser memory on a restart. Hello sends
fresh role frames without waiting for another action. Clock correction rebases
only the ring's animation, and stacking steps apply per keyframe segment.

[After measurements](motion-and-board-after.json) use the same isolated prop
probe before path thinning. Paint CPU changed from 66.0 to 5.3ms for Deal, 72.8
to 7.9ms for Flop, 72.6 to 9.9ms for Chips and 123.3 to 20.6ms for Pot. These
are observation-window sums from headless Chromium, not FPS/device guarantees.
[The settled peek](peek-after.json) now has zero rAF callbacks and geometry reads;
moving/release peeks also use their cached geometry.

The representative 80-frame pitch/receive path uploads 58 frames with the final
strict simplification tolerances. Pure tests cover interpolation error, high-spin
folds, contacts, pauses, taps and stacking. The grouped project suite passed,
and typecheck/build and real-component table/phone/clock checks passed. A final
review also identified and corrected segment easing and clock-offset rebasing.

The new motion stress scenarios make eight-seat deals, gathers and phone gestures
ordinary to inspect. They were exercised as smoke checks; the saved performance
comparison remains an isolated-prop measurement. Physical-device sound, Safari
and multi-device synchronization still use the manual checklist.

Static felt textures and finite interest-kit celebrations were retained: their
replacement was conditional on evidence of costly invalidation, which this
sweep did not find. No extra texture assets, dependency, general framework,
frame heartbeat, or browser-driven game rules were needed.


### Curved peek follow-up

The lifted-card peek uses eight shared curve/plane samples per card, fractional
pixel dimensions and placement, gradual curvature, continuous leaf-level shade,
and a prepainted soft shadow footprint moved with transforms and opacity.
A 1.8-second drag in headless mobile Chrome at 393 CSS px, 2.75× pixel density
and 4× CPU throttling recorded raster-task CPU decreasing from 717ms to 432ms
when reducing twelve samples to eight and removing the live blurred shadow
mask. Callback CPU changed from 138ms to 107ms. These are worker/main-thread
window sums, not physical-Pixel FPS measurements. The browser's rAF intervals
stayed near 16.7ms in both cases. Phone-size edge checks retained under 0.001px
placement error. Cached print images and rectangular-crop/layer-promotion
experiments did not improve the result and were discarded.


The [rendering lessons and session handoff](rendering-handoff.md) records the full
curve/seam/performance investigation, discarded experiments and remaining Pixel
sluggishness. The [GPU peek task outline](../../superpowers/plans/2026-10-01-poker-gpu-peek.md)
records the implemented rendering direction; physical Pixel verification remains
pending. See the implementation results below.


### GPU peek implementation

The DOM strips and their clipping/shade machinery are removed. One WebGL canvas
renders two whole cards with 48 crease-aligned curve bands, one flat band and one
raised-plane band each (100 triangles per card), shared gradual curvature,
surface-normal stack separation, correct side/UV selection and continuous lighting.
The initial GPU boundary used a single soft ellipse (three draw calls). The
subsequent renderer projected two softened silhouettes (four draw calls). The
next renderer analytically unioned both masks before a single blend (three draw calls).
The current renderer projects the actual meshes into a binary mask and composites
it once, then draws the cards (five draw calls). There
are no texture uploads, layout reads or DOM shape/style writes per drag frame.
The stress scene's independent shot clock still generates some DOM/native paint work.

Prints are captured from the real component/font/tokens, losslessly encoded locally,
alpha-padded and versioned. Only three active-hand images are uploaded (~9.4 MiB of
RGBA texture storage, no mipmaps). Canvas backing size is capped at 3× and 1.5M
pixels; its colour/depth/MSAA allocations are additional and driver-dependent.
Buffers/program/textures are reused; held peeks draw nothing. A simple flat reveal
covers unavailable/loading GPU resources. Native deal/throw/showdown remain intact.

Matched local hardware ANGLE Metal comparison, 393 CSS px, DPR 2.75, CPU throttle 4×,
1.8-second synthetic drag:

| CPU window sum | Original DOM | Final GPU |
| --- | ---: | ---: |
| Animation callbacks (including the input driver) | 143.18ms | 21.56ms |
| Style updates | 41.92ms | 7.55ms |
| Paint | 60.04ms | 14.37ms |
| Raster workers | 21.79ms | 3.53ms |

Both runs had near-16.7ms rAF cadence. These measurements demonstrate less browser
CPU work, **not increased physical-phone FPS**. Saved reports:
[matched DOM](gpu-dom-metal.json), [final GPU](gpu-mesh-final-metal.json),
[initial default-backend DOM](gpu-dom-baseline.json),
[grouped browser boundary results](gpu-boundary-check.json).
The early mesh report is retained as [GPU proof](gpu-mesh-metal.json).

The [profile script](profile-gpu-peek.mjs) mounts the real phone stress component.
Run the motion server, then `POKER_GL=metal node docs/audits/poker-animation/profile-gpu-peek.mjs label`
on a Mac with hardware Metal; use the suitable ANGLE backend elsewhere or omit
`POKER_GL` for the browser default. Always inspect the recorded GPU backend.
Default software WebGL ran much more slowly despite tiny DOM raster cost; CPU
throttling and software GL are not a Pixel GPU model. Do not compare the initial
457ms default-backend raster baseline with the hardware GPU report as a matched gain.

Grouped checks covered shallow/medium/deep peeks at phone density, another phone
width, stationary sleep, context loss/restoration, resize, hand changes, native
showdown, successful fold retirement, early refused fold after a retired prior
hand, reduced motion, failed textures, unavailable WebGL and unmount cleanup.
Focused geometry/gesture checks, typecheck/build and the interface detector passed.
The final review caught retained-canvas context loss after refusal; the reproducing
browser check failed before the lifetime fix and passed afterward. No new UI unit
suite or project-wide test loop was added. The user subsequently confirmed the Pixel peek is “smooth fast and responsive.”
The physical device remains unprofiled; this is user-observed responsiveness, not
a measured FPS claim. Maximum peek reach was then increased from 1.2 to 1.4 card
widths so the suit indices clear the bend; the gradual curve is retained. A
phone-size full-lift check showed both suits clearly, and focused checks/build passed.


Peek tuning after phone feedback: reach is now 1.45 card widths. Release is 80ms
with a quadratic ease-out instead of the slow-start 120ms return. The GPU cast
shadow was present but largely covered by the prints; its centre now follows the
card along the crease, and its larger/stronger soft footprint extends onto exposed
felt. An isolated shadow-on/off check confirmed visible cloth darkening. A
phone-sized release check observed ~95ms including frame scheduling; focused
checks, typecheck and build passed. The renderer still uses three draw calls and
no moving blur filters or texture uploads.


The oval remained too inconspicuous on the phone despite measurable pixel
darkening. It has been removed, including its placement/strength workaround.
Each lifted card now projects one affine silhouette toward the lamp's cast
direction. A rounded source outline and gradual bend mask soften its bounds;
affine projection avoids the earlier folded-shadow self-overdraw. The resulting
shadow has a recognizable card edge and extends visibly below the raised pair at
full peek in the phone-size check. This adds one draw call, with no blur filters,
texture uploads or DOM animation layers. Focused checks/typecheck/build passed.
The [silhouette follow-up profile](gpu-silhouette-metal.json) retained near-16.7ms
rAF cadence under the same local hardware/mobile/4×-CPU probe, with no slow
intervals, no drag uploads/layout reads, and zero settled draws. This is still
local rendering evidence rather than a physical-phone frame-rate claim.


### Shadow union and adversarial visual review

The user caught two defects after the silhouette change: source-over alpha
blending darkened the overlap twice, and raised-plane extrapolation plus a fixed
offset/bend mask could leave a card → exposed-felt → shadow gap. Those operations
are removed. The common projection now starts at the crease and both rounded
source masks are evaluated in the same fragment; `max` coverage is blended once.
A larger mesh guardband covers the penumbra, which grows with lifted material
instead of retaining a uniformly narrow edge.

A shadow-only probe of the real GPU renderer found zero alpha difference between
two coincident cards and one, and nonzero coverage continuously across the tested
contact interval. This proves those specific mask/composition invariants; it does
not prove realistic appearance. Focused checks, typecheck and build passed.

At the user's explicit request, an independent adversarial critic inspected
shallow/medium/full captures at phone scale and zoom. The first pass found a
shield-shaped tip and overly hard distant edges; depth-dependent softness was
added. The second pass found no renewed overlap seam, obvious bright gap, or blur
clipping, and found the hard cutout tip suppressed. Its remaining assessment:
the shadow is still a broad affine approximation, not physically traced bend
occlusion. Stills do not establish attachment throughout a drag or performance
on the actual Pixel. Do not turn pixel presence or a green build into a blanket
“looks good” claim; assess overlap, attachment, shape and softness separately.
Saved evidence: [union/contact probe](shadow-union-check.json) and
[final local hardware profile](gpu-shadow-union-metal.json). The local drag retained
near-16.7ms rAF cadence with no slow intervals, uploads or layout reads; held
peeks performed zero draws. The renderer is back to three draw calls per frame.


### Binary projection of the actual bend

The user still observed the folding tip darkening the body shadow, and clarified
that the whole cast should have one flat darkness. The affine mask and its
lift-dependent opacity/feathering have been removed. The actual deformed card
meshes now project onto the cloth into a half-resolution RGBA target, with
blending disabled. Every covered fragment writes white; overlapping cards and
self-overlapping folded stock overwrite the same value. Transparent regions
discard rather than erasing other coverage. One composite applies fixed 0.38
opacity to that union, with a small common boundary feather. The light direction
is deliberately simple; the user's “slightly above” comment was not a request
for a lighting redesign. Card-material crease shading remains separate.

The target has no depth/MSAA allocation and is at most 375k pixels (~1.43 MiB
RGBA), in addition to the existing canvas and active prints. It is sized at
initialization/gesture configuration, reused while dragging, and rebuilt or
disposed with the renderer. Five small draws replace the old analytical shadow
pass; no texture uploads or browser layout are needed during drag frames.

The actual GPU mask check read only alpha values 0/255, zero coincident-caster
opacity difference, and uniformly 97/255 composited alpha throughout the tested
contact/core interval. Context loss/restoration, resizing and disposal also
passed, with no WebGL errors. The controlled loss diagnostic waits before
requesting restoration, as immediate extension-driven restoration was not
reliably delivered by the local browser. Focused checks/typecheck/build passed.

The adversarial critic inspected shallow/medium/full phone-size captures and
found a continuous flat-dark band along the lower contour, no extra-dark overlap
patch, no detached gap, and no previous broad artificial field. It separated
cloth texture and card-surface lighting from cast opacity. This still does not
verify every intermediate tip-folding position or the actual Pixel's rendering.
Saved evidence: [binary mask/core/lifecycle check](shadow-binary-mask-check.json)
and [local hardware profile](gpu-binary-shadow-metal.json). The final local probe
retained steady rAF cadence, zero drag uploads/layout reads and zero held draws.
The profile now counts both indexed mesh draws and the composite quad draw.


## Poker motion costs

Keep table facts separate from local time: the shot ring and blind-level readout
advance between state pushes, and the table rerenders when the game changes.
Deal and showdown trajectories are retained for the hand and table dimensions.
A peek measures the settled pair once with fractional pixel dimensions and placement,
redraws on pointer changes and sleeps while the finger rests. One bounded WebGL
canvas owns both whole cards during peek, including their flat portions. Crease-aligned
mesh bands share a gradual material curve and elevated plane; depth separation
reverses the stack naturally through the turn. Printed backs retain their resting
orientation and faces use mirrored UVs. Continuous shader lighting and soft
projected silhouettes on exposed felt suggest flexible stock under the lamp.
The actual bent meshes project into one binary GPU occlusion mask. Covered pixels
are opaque regardless of self-overlap or overlap between cards; that union is
composited once at fixed darkness. Only its outer boundary is softened. Keep
card-surface lighting separate from this cast shadow. The mask is half the
canvas resolution, allocated outside drag frames and owned by the same lifecycle.
Released cards spring back immediately and soften their landing, with a shorter
return than the initial lift.

The active hand's two faces and shared back are generated from the real card
component, local font and tokens, decoded and uploaded before use, then reused.
Transparent texture padding keeps oblique edges clean. Regenerate with
`npm run poker:prints` after print changes; generated content versions prevent stale
cached artwork. Canvas resolution is capped at 3× and 1.5 million pixels. Context
loss, hand/match changes, resize and unmount cancel or release the right work.
Native cards own deal, rest, throw and showdown. If GPU rendering or textures are
unavailable, holding a peek gives a simple flat reveal until release. There is no
parallel DOM bend renderer or continuous resting animation loop.

Cards travel with direct transforms, hinged flips and shade opacity. Uploaded
paths are thinned within 0.3px of position, 0.25° of rotation/turn and 0.0006
lift, with contact, pause, tap and stacking landmarks retained exactly. Their
contact, ambient and airborne shadow silhouettes are prepainted and transformed
or crossfaded, keeping blur and printed faces stable. Chip stacks use their
arrival lighting throughout a push. Meter fills transform, and the overbet glow
crossfades a fixed shadow. Static felt fibres and masks retain their established
appearance; they do not need animation clocks.

The motion kit's “Eight-seat table stress” and “Phone gesture stress” scenarios
use real components with synthetic frames, including selectable duplicate frame
cadence. They never connect to or mutate the room.

### Peek renderer ownership (from ARCHTECTURE.md)

The phone's local peek is owned by `PokerPlayer.tsx` (gestures and rAF lifecycle),
`poker-bend.ts` (shared material curve/profile) and `poker-peek-renderer.ts`
(two whole textured meshes, a binary projected-shadow mask and bounded WebGL resources). Native cards retain
other motion. `tools/poker-prints.ts` generates local textures from `PlayingCard`
and its real stylesheet/font via a development-only print page; only the active
hand is uploaded. GPU loss/loading failure has a simple flat reveal fallback.
