# Visual study harness

**Status:** design record for the bow minigame studies and the harness that should replace hand-authored comparison boards.

## Purpose

The bow studies exposed a repeatable problem: a standalone SVG can compare ideas, but every study spends substantial effort rebuilding the same page, component geometry, labels, rendering command, and review setup. Small coordinate mistakes also survive source inspection because the SVG remains syntactically valid while depicting the wrong physical relationship.

Build a development-only visual study harness for component exploration before a component is adopted into the game. It should make geometry, material, motion, and timing directly adjustable; render controlled A/B/C comparisons from shared primitives; expose deterministic URLs and export controls for review; and preserve an approved study as data that can drive the real component and the existing motion workbench.

This harness complements `npm run motion`. The visual study harness explores and selects component anatomy and motion language. The existing motion workbench continues to tune adopted real components against their real containers, CSS, sound cues, and runtime behavior.

## What went wrong in the manual studies

These are harness requirements, not merely historical notes.

1. **Arrow direction was reversed.** Early arrowheads pointed opposite the stated flight direction. Source coordinates looked plausible without an explicit forward-axis reference.
2. **Bow anatomy was mirrored.** The bow body and string traded sides. The accepted orientation is an arrow travelling right, a bow body curving right like `)`, and a string drawn left.
3. **The insertion boundary moved sides.** A flex sequence put the insertion wall on the left while the component examples established a right-facing arrow and a boundary on the right. This made later curve corrections ambiguous.
4. **The wrong part of the arrow bent.** Several passes bent the center or rotated the whole shaft. The accepted collision response holds the arrowhead and final third still and displaces the free tail, like a spring doorstop.
5. **The tail became decorative hardware.** Early arrows gained flared vanes and a strange butt silhouette. The accepted arrow has one compact, single-colour identity cap aligned to the shaft.
6. **The target was treated as a penetrable image.** An arrow was drawn into a scoring ring. In the 2D game, collision and lodging happen only on the target perimeter.
7. **Impact light crossed the target face.** Ripples were initially centered over the scoring image. Accepted impact light originates at the perimeter contact and is masked to surrounding space.
8. **Insertion depth was binary.** One pass left the point floating against the boundary; another hid it too deeply. The accepted visual inserts roughly one eighth of the arrowhead beneath the perimeter, with the target layered above the buried portion.
9. **The first ripple was ornamental.** Three strong irregular loops competed around the arrowhead. The accepted treatment uses exactly two clean concentric pulses with slightly fuzzy edges and a tight halo that barely leaves each line.
10. **SVG filters produced misleading artifacts.** A blurred bloom rendered with a rectangular filter footprint. Rendering and inspecting the actual output caught what markup review did not.
11. **Presentation defects distracted from the decision.** Long captions clipped and a `TARGET EDGE` label collided with metadata. Comparison chrome needs its own layout constraints and overflow checks.

The practical lesson is that semantic geometry, controlled variables, and rendered-output review must be built into the tool. More careful freehand coordinates are not a sufficient fix.

## Decisions already approved

The harness should open with these bow values as its first reference study.

### Target

- Painted canvas construction with a grounded drop shadow.
- Outer-to-inner colours: warm white, charcoal, muted blue, oxide red, and ochre.
- A dark outer outline keeps the warm-white ring legible against the field.
- Scoring artwork remains unchanged by collision and ownership effects.

### Arrow

- Painted cedar shaft with a dark inked edge and metal point.
- Flight direction is right by default.
- Identity is a compact, single-colour tail cap; no flare or decorative vane silhouette.
- A lodged point sits about one eighth of its head length beneath the target perimeter.

### Bow

- Painted field bow: laminated cedar, leather grip, painted bindings, and grounded shadow.
- In the canonical right-facing pose, the body curves right and the string is pulled left.
- Identity stays at the grip.

### Target impact

- Selected treatment: clean concentric pulse.
- Exactly two identity-colour rings.
- Ring edges are slightly softened. Each ring has a narrow, low-opacity halo close to its stroke.
- The pulses start at the perimeter contact and render only in surrounding space.
- The target face does not glow, deform, or receive an ownership mark. Ownership remains readable from the arrow cap and temporary pulse colour.

### Arrow-on-arrow collision

- Selected treatment: tapered twang.
- The target is on the right, the lodged arrow points right, and its free tail extends left.
- The arrowhead and final third stay planted. Curvature grows toward the free tail.
- The motion has one strong kick, one smaller opposite overshoot, a small return, and a quick settle. The current 75/155/235/360ms study frames are exploratory values, not yet gameplay constants.
- The incoming arrow glances away instead of lodging into the existing arrow.

Current comparison artifacts live in `docs/superpowers/visuals/`. They are visual records, not reusable implementation sources.

## Harness boundary

Add a development-only entry point, tentatively `/visual.html`, with an `npm run visual` command. Do not put the study registry or editor into the production build.

Keep it separate from `/anim.html` at first. The motion workbench mounts real components and writes approved CSS tunables and cue recipes. The visual harness needs draft-only vector primitives, geometry overlays, multi-variant comparison, and viewport composition. Combining those concerns now would make the mature motion workflow harder to understand.

Share small control and persistence utilities where that removes real duplication. Do not create a general plugin system or a second design-token system.

## Canonical coordinate model

Every study declares its semantic coordinate frame before drawing:

- `forward` defaults to positive X;
- an arrow's `tail`, `shaft`, and `head` are named parts, not anonymous paths;
- a target collision uses a perimeter point and outward normal;
- `insertionDepth` is a fraction of arrowhead length;
- `anchoredFraction` is measured from the arrowhead toward the tail;
- tail displacement is expressed perpendicular to the resting shaft;
- effects declare whether they render inside, outside, or across a collision shape.

Mirroring must be one explicit transform of the complete assembly. Individual head, string, body, or cap paths may not be mirrored independently. A debug overlay shows the forward arrow, contact normal, collision perimeter, buried head segment, anchor boundary, and free-tail region.

The debug overlay is off in presentation exports and on by default in edit mode.

## Reusable study primitives

The first registry should be deliberately small:

- `Target`: ring palette, outline, canvas texture, scale, rotation, and shadow;
- `Arrow`: length, shaft thickness, material, head length, cap length, identity colour, and shadow;
- `Bow`: limb profile, string pull, grip, bindings, orientation, and shadow;
- `LodgedArrow`: target contact, insertion depth, anchored fraction, and tail displacement;
- `Pulse`: count, spacing, stroke width, edge softness, halo width, halo opacity, duration, and outward-only mask;
- `GlancingArrow`: approach vector, collision point, exit vector, and identity colour;
- `StudyCard` and `ComparisonBoard`: fixed chrome, controlled-variable caption, recommendation or selected badge, notes, and overflow-safe metadata.

Primitives use the existing design tokens and identity ramp. Draft values live in typed study recipes. A comparison variant overrides only the dimensions under examination; shared values remain visibly listed as controlled variables.

## Editing and review surface

The stage supports four layouts:

1. A/B/C comparison cards;
2. one selected variant at large scale;
3. a motion strip with explicit frame times;
4. the selected variant in board, phone, and 1400px square presets.

Controls are grouped by meaning:

- **Geometry:** orientation, component dimensions, contact point, insertion depth, anchored fraction, and bend amplitude;
- **Material:** palette, outline, texture, highlight, and shadow;
- **Effect:** pulse count, radius, line softness, halo width and opacity, mask side, and compositing order;
- **Motion:** duration, frame positions, easing, overshoot, damping, loop, and playback speed;
- **Scene:** viewport preset, zoom, background, identity colours, collision debug overlay, and room-scale preview.

The editor needs retrigger, pause, frame step, timeline scrub, 0.1x playback, ghost-frame overlay, and reduced-motion preview. A `Reset variant` action returns only the active option to its recipe. A separate `Reset study` returns every controlled value to the committed baseline.

The URL must encode the study, variant, frame or time, viewport, and debug state. Examples:

```text
/visual.html?study=bow-impact&variant=A&time=170&viewport=square&debug=1
/visual.html?study=arrow-clank&variant=B&time=155&viewport=board&debug=0
```

These URLs make a review reproducible and remove the need to explain or reconstruct a viewing window each time.

## Export and adoption

Provide `Download SVG` and `Download PNG` from the current deterministic frame. Export uses the exact rendered study scene and strips editor chrome and debug overlays unless requested. It must not rebuild a separate approximation of the preview.

Draft recipes may persist in the URL and local storage. Writing source remains an explicit `Adopt` action patterned after the motion workbench's save flow:

1. show the exact recipe and source-file diff;
2. write reusable primitive defaults or an approved named variant;
3. mark the comparison option selected;
4. preserve other variants as study context without shipping them in the game.

Once real minigame components exist, create corresponding `/anim.html` scenarios that mount those real components. Motion values used by production must then live in the owning CSS or typed visual recipe, never be restated in a harness scenario.

## Self-review protocol

Every proposed comparison gets reviewed from rendered output, never source alone.

1. Open the canonical right-facing reference and confirm arrowhead, tail, bow body, and string orientation.
2. Enable collision debug mode and confirm the contact normal, target side, one-eighth insertion, compositing order, and anchored/free regions.
3. Disable debug mode and judge the actual presentation frame.
4. Inspect at large scale, board scale, and phone scale.
5. Scrub every named keyframe and play once at 1x and 0.1x.
6. Test two simultaneous identity colours and several lodged arrows for overlap.
7. Confirm effects respect their masks and do not alter scoring artwork.
8. Check filter bounds for rectangular clipping, shadow cutoff, and glow seams.
9. Check card headings, captions, badges, and metadata for clipping or collisions.
10. Compare A/B/C with identical controlled values and confirm each option differs only along the named design dimension.
11. Render a second pass after corrections before presenting the study.

For automated checks, validate generated SVG markup, assert semantic invariants such as `forward = +X`, `pulseCount = 2`, and `effectRegion = outside`, and capture deterministic snapshots where the project has a suitable browser capture path. Pixel snapshots should catch gross orientation, masking, and filter-bound regressions; they should not replace the visual review above.

## Initial studies

Implement enough of the harness to reproduce these approved studies first:

1. painted canvas target comparison and selected target;
2. painted cedar arrow anatomy and orientation;
3. painted field bow anatomy and draw orientation;
4. two-ring outside-only target impact at one-eighth insertion;
5. tapered-twang arrow collision with the target on the right.

The next new study is player bow-draw and tension feedback. It should be the first comparison authored directly in the harness, which will test whether the tool actually reduces setup work before more minigame visuals are explored.

## Validation

Harness implementation should include focused tests for recipe merging, semantic transforms, outside-only masks, insertion-depth geometry, deterministic URL state, and source adoption. Run the normal typecheck and build; verify that `visual.html` is absent from production output. Manual validation uses the self-review protocol above and checks that existing `npm run motion` scenarios and save behavior remain unchanged.
