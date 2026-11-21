# Bow resolves contacts exactly, deterministically, and from the shape at contact time

Bow's field is server-authoritative and must replay identically from a seed, so its collision code favours exact first-contact maths and fixed tie-breaks over cheaper approximations.

- Overlap at the start of a sweep is contact at `t = 0`, never the later exit: a tip already inside a target circle, a stuck shaft or outside the field lodges now.
- Arrow pairs in flight are swept as capsules using relative motion, so shafts are compared at the same instant (no swept-footprint false hits). Directions are fixed over one sweep; there are no angular dynamics.
- For disjoint segments, first contact always involves an endpoint, so checking the four endpoints against the other capsule is complete; no interior-interior case is missing.
- A contact with no unique normal (crossing interiors, a tip exactly on a shaft) uses the incoming motion; coincident stationary shafts fall back to `normalize`'s fixed `(0, -1)`.
- Ties are broken by fixed rules, never caller array order: field boundaries win exact ties, targets are compared by id, arrows are processed in id order.
- Two flying arrows collide shaft to shaft; a flying arrow meets a stuck one only with its tip. Against a stuck arrow, restitution only picks the reflected direction and the flyer keeps 80% of its speed.
- The post-impact separation clears whole shafts for a flying pair (reorienting can push a tail through the other) and only the tip for a stuck one. That push is swept against surfaces, so it can lodge or score but never tunnels; the reflected velocity is kept.
- `stepBow` recomputes every contact after each impact, so a deflected arrow cannot score on its old path, drains zero-time contacts (including ties at the end of the tick), and consumes each arrow pair at most once per tick.
- World time is `tick * BOW_STEP_MS`, never accumulated; lifetimes compare with a `1e-9` tolerance so an exact-tick lifetime does not slip a tick.
- `pointSegmentDistance` duplicates `closestPointOnSegment` in scalar form to avoid allocating points for every shaft pair.
- The fallback target in `createTargets` sits inside its lane and well above the bows.
- `sampleBowTrajectory`'s aim preview is purely ballistic (one sample per future fixed step, launch point excluded): reload, obstacles, scoring and lifetime are ignored on purpose.

Where: `server/minigames/bow/geometry.ts` (`segmentCircleHit`, `sweptSegmentHit`, `tipCapsuleHit`, `pointSegmentDistance`), `server/minigames/bow/world.ts` (`createTargets`, `outsideField`, `surfaceHit`, `collide`, `stepBow`, `sampleBowTrajectory`)
