# Motion harness dials, origins and Save

A dial edits a number committed to a file, so its origin marker and Reset must mean "what the file holds now".

- Three dial kinds share one `Dial` type: `var` (a custom property in `anim:tunables`), `recipe` (`cue.layer.field` in `cues.ts`) and `motion` (`NAME.field` or `NAME.field.i` in `toss.ts`). The slider, origin, dirty state and Save treat them alike. Their keys cannot collide: a var has dashes, a motion key starts with a capital.
- CSS origins are read from the stylesheet, recipe origins from the committed `RECIPES`, motion origins from `toss.ts`'s constants. A successful save re-captures CSS and motion origins, because the saved number is now the baseline. The recipe baseline is only re-seeded on reload, since the in-memory `RECIPES` is the pre-save module.
- Recipes are edited as a draft tree, not flat `cue.index.field` override keys: removing layer 0 would silently retarget every key naming layer 1. Dirty state compares the draft with `RECIPES` wholesale, which catches structural edits. Recipes are sent to Save only when they changed, because the marked block is regenerated wholesale and would reformat `cues.ts` otherwise.
- Recipe dials come from the draft (`recipeDials`), so a layer added a moment ago gets dials and a removed one loses them. A dial on a layer absent from `RECIPES` is never "moved" and offers no reset; treating the missing value as 0 would let Reset zero the sustain `addLayer` set to keep the layer audible.
- `applyMotion` runs during render, not in an effect, because the scene computes its throws as it renders.
- The scenario id and the last save message live in `sessionStorage`, because saving a motion number rewrites `toss.ts` and Vite reloads the page.
- The download trim (`head`, `cut`, `rate`) is plain Library state rendered with a bare `Slider`, not a `Dial` or an `anim:tunables` property: nothing is committed for it, and it belongs beside the list it acts on.
- A dial's original value is a notch under the range track, not a line across it: an overlay sits behind the input's track (invisible) or on the thumb (reads as the handle). The notch is inset by half a thumb at each end, as the browser places the thumb, or it drifts at the extremes.
- Interest-kit dial names are written out in full in `scenarios.tsx`, because `tunables.test.ts` scans that file for `--fx-*` names; a templated name would slip past the check.

Where: `client/anim/main.tsx` (`readDefaults`, `readMotion`, `origin`, `draft`, `save`, `Slider`, `kept`/`keep`, `trim`), `client/anim/scenarios.tsx` (`Dial`, `dialKey`, `applyMotion`, `recipeDials`, `ms`/`amount`), `client/anim/harness.css` (`.harness__origin`), `client/tunables.test.ts`
