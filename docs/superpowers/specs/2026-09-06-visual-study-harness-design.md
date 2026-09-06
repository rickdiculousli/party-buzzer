# Visual study harness

**Status:** project-wide design record for discovering any new visual component. The bow minigame is its first case study and regression fixture.

## Purpose

The harness is for any visual component whose form has not been established yet: game equipment, controls, indicators, icons, field objects, feedback effects, layout assemblies, and future minigame parts. It is the place to discover a visual language before production components and motion rules exist.

A standalone SVG can compare ideas, but every study spends substantial effort rebuilding the same page, component geometry, labels, rendering command, and review setup. Small coordinate mistakes also survive source inspection because the SVG remains syntactically valid while depicting the wrong physical relationship.

Build a development-only visual study harness for component exploration before a component is adopted into the game. It should make composition, geometry, material, state, motion, and timing directly adjustable; render controlled A/B/C comparisons from shared primitives; place real-world and visual references beside the candidate; expose deterministic URLs and export controls for review; and preserve an approved study as data that can drive the real component and the existing motion workbench.

This harness complements `npm run motion`. The visual study harness explores and selects component anatomy and motion language. The existing motion workbench continues to tune adopted real components against their real containers, CSS, sound cues, and runtime behavior.

## What the bow case study taught us

These failures are preserved as general harness requirements, not merely historical notes.

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

The practical lesson is that semantic geometry, controlled variables, external references, and rendered-output review must be built into the tool. More careful freehand coordinates are not a sufficient fix. Every future component should benefit from these checks even when it has nothing to do with archery.

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

## Semantic component model

Every study declares its semantic structure before drawing:

- a local origin, forward axis, up axis, scale, and handedness;
- named parts and their expected order, rather than one anonymous path;
- anchors, joints, attachment points, occlusion order, and collision boundaries;
- regions that are fixed, flexible, interactive, or decorative;
- effects that declare whether they render inside, outside, behind, or across a shape;
- state and motion constraints that remain true while tunable values change.

Mirroring must be one explicit transform of a complete assembly. Individual parts may not be mirrored independently unless the study explicitly declares them symmetric. A debug overlay shows axes, part names, anchors, boundaries, normals, occluded regions, fixed regions, and flexible regions.

Domain studies add typed constraints. The bow fixture declares `forward = +X`; names `tail`, `shaft`, and `head`; measures `insertionDepth` as a fraction of arrowhead length; measures `anchoredFraction` from the head toward the tail; and expresses tail displacement perpendicular to the resting shaft. Other component families define their own vocabulary without adding conditionals to the harness shell.

The debug overlay is off in presentation exports and on by default in edit mode.

## Reusable study primitives and static registry

The harness uses a small static study registry. It is not a general plugin framework. A study registers a typed recipe, variants, reference material, render function, semantic checks, viewport presets, and adoption target.

The shared foundation should remain deliberately small:

- `Study` and `Variant`: controlled values, differences under examination, status, and notes;
- `Assembly` and `Part`: named vector parts with explicit order and transforms;
- `Anchor`, `Joint`, and `Boundary`: semantic geometry and optional debug rendering;
- `EffectRegion`: inside, outside, behind, or crossing masks and compositing order;
- `MotionPose`: named time, part transforms, deformation, and ghost-frame display;
- `Reference`: a local image, source URL, caption, orientation, and optional alignment anchors;
- `StudyCard` and `ComparisonBoard`: fixed chrome, controlled-variable caption, recommendation or selected badge, notes, and overflow-safe metadata.

The bow fixture then supplies domain primitives:

- `Target`: ring palette, outline, canvas texture, scale, rotation, and shadow;
- `Arrow`: length, shaft thickness, material, head length, cap length, identity colour, and shadow;
- `Bow`: limb profile, string pull, grip, bindings, orientation, and shadow;
- `LodgedArrow`: target contact, insertion depth, anchored fraction, and tail displacement;
- `Pulse`: count, spacing, stroke width, edge softness, halo width, halo opacity, duration, and outward-only mask;
- `GlancingArrow`: approach vector, collision point, exit vector, and identity colour;

Primitives use the existing design tokens and identity ramp. Draft values live in typed study recipes. A comparison variant overrides only the dimensions under examination; shared values remain visibly listed as controlled variables. A newly discovered component may add a focused domain primitive without changing the editor shell.

## Reference-assisted visual review

When a component has real-world anatomy, established ergonomics, or a recognizable visual convention, review must use external references before a direction is locked.

1. Search the web for clear reference images from manufacturers, museums, governing bodies, technical manuals, or strong orthographic photography. Prefer primary sources when they exist.
2. Record the source URL and what fact the image establishes: orientation, attachment order, silhouette, grip, articulation, scale, or material behavior.
3. Cache only a development reference or screenshot needed for the study. Do not ship fetched images, hotlink them from the UI, or turn web access into a runtime dependency.
4. Render the candidate SVG to a raster image through the same browser path used by the harness. Source markup alone is never the reviewed artifact.
5. Place the web reference and rendered candidate side by side, with optional opacity overlay, mirroring, alignment anchors, and silhouette mode.
6. Inspect both with multimodal vision for glaring orientation, anatomy, occlusion, proportion, and composition errors. State the physical relationship in words before accepting the image.
7. When raster image generation would help explore a correction, provide both the references and the current rendered SVG image to image generation. Ask for focused alternatives around the disputed relationship. Treat generated images as visual suggestions, then rebuild and verify the chosen geometry in the repo-native vector primitive.

Image generation is not a geometry validator and its raster output does not become the production asset by default. The required check is still a reasoned comparison between authoritative references and the actual rendered SVG. This preserves the benefit of image-assisted critique without allowing a plausible generated image to overwrite known physical constraints.

## Editing and review surface

The stage supports four layouts:

1. A/B/C comparison cards;
2. one selected variant at large scale;
3. a motion strip with explicit frame times;
4. the selected variant in board, phone, and 1400px square presets.

A fifth reference layout places one or more sourced images beside the active render, with synchronized zoom, mirror, silhouette, and alignment overlays. Reference controls remain development-only and do not fetch assets from the production client.

Controls are grouped by meaning:

- **Geometry:** orientation, component dimensions, contact point, insertion depth, anchored fraction, and bend amplitude;
- **Material:** palette, outline, texture, highlight, and shadow;
- **Effect:** pulse count, radius, line softness, halo width and opacity, mask side, and compositing order;
- **Motion:** duration, frame positions, easing, overshoot, damping, loop, and playback speed;
- **Scene:** viewport preset, zoom, background, identity colours, semantic debug overlay, room-scale preview, and reference comparison mode.

The editor needs retrigger, pause, frame step, timeline scrub, 0.1x playback, ghost-frame overlay, and reduced-motion preview. A `Reset variant` action returns only the active option to its recipe. A separate `Reset study` returns every controlled value to the committed baseline.

The URL must encode the study, variant, frame or time, viewport, debug state, and reference layout. Examples:

```text
/visual.html?study=bow-impact&variant=A&time=170&viewport=square&debug=1&reference=side
/visual.html?study=arrow-clank&variant=B&time=155&viewport=board&debug=0&reference=off
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

1. State the component's orientation, part relationships, interaction, and intended read in plain language.
2. Gather web references for any recognizable anatomy, material behavior, or convention and record what each reference proves.
3. Render the candidate SVG to an image and inspect it beside the references with multimodal vision. Use image generation with the references and current render when a focused correction study would help.
4. Enable semantic debug mode and confirm axes, anchors, joints, boundaries, occlusion order, fixed regions, flexible regions, and effect masks.
5. Disable debug mode and judge the actual presentation frame.
6. Inspect at large scale, board scale, and phone scale.
7. Scrub every named keyframe and play once at 1x and 0.1x.
8. Test multiple simultaneous identity colours and repeated components for overlap where relevant.
9. Confirm effects respect their declared regions and do not alter unrelated artwork.
10. Check filter bounds for rectangular clipping, shadow cutoff, and glow seams.
11. Check card headings, captions, badges, and metadata for clipping or collisions.
12. Compare A/B/C with identical controlled values and confirm each option differs only along the named design dimension.
13. Render and inspect a second pass after corrections before presenting the study.

The bow regression applies the general checks concretely: confirm the arrow points right, the tail sits left, the bow body curves right, the string pulls left, the target boundary is on the right for a lodged arrow, insertion is one eighth of the head, and only the free tail bends.

For automated checks, validate generated SVG markup, assert each study's semantic invariants, and capture deterministic snapshots where the project has a suitable browser capture path. The bow fixture includes `forward = +X`, `pulseCount = 2`, and `effectRegion = outside`; these are fixture rules rather than universal harness assumptions. Pixel snapshots should catch gross orientation, masking, and filter-bound regressions; they should not replace the reference-assisted visual review above.

## Initial studies

Implement enough of the general harness to reproduce these approved studies first:

1. painted canvas target comparison and selected target;
2. painted cedar arrow anatomy and orientation;
3. painted field bow anatomy and draw orientation;
4. two-ring outside-only target impact at one-eighth insertion;
5. tapered-twang arrow collision with the target on the right.

The next new study is player bow-draw and tension feedback. It should be the first comparison authored directly in the harness, which will test whether the tool actually reduces setup work. After that, author one unrelated existing component study to prove the architecture is general and does not secretly encode archery.

## Validation

Harness implementation should include focused tests for recipe merging, semantic transforms, region masks, reference state, deterministic URL state, and source adoption. Bow fixture tests cover insertion-depth geometry and outside-only impact masks. Run the normal typecheck and build; verify that `visual.html` is absent from production output. Manual validation uses the self-review protocol above and checks that existing `npm run motion` scenarios and save behavior remain unchanged.
