# Bow Minigame Visual and Microinteraction Design

**Status:** Rejected exploration. Do not implement these studies. They are kept
only to preserve design history and feedback. The behavioral contract remains
in [the minigames design](2026-09-06-minigames-design.md).

The mechanics-first build uses plain placeholders. A later visual pass starts
by establishing one consistent style for the complete minigame rather than
continuing these component directions.

## Shared direction

The bow minigame uses a disciplined handmade prop language on the existing dark
stage. Painted surfaces have charcoal outlines and tactile drop shadows. Colors
are tinted to fit the Party Buzzer palette rather than using pure primaries.

The design-system split remains intact: player identity colors show ownership,
cyan shows a measured value, and warm signal colors carry drama or readiness.

## Former selections

- **Target:** painted canvas, study B. Rings use tinted warm white, charcoal,
  muted blue, oxide red, and ochre, with a dark outer outline.
- **Arrow:** painted cedar, study B. The arrow uses a compact, single-color
  identity cap at its tail and no flared tail shape.
- **Bow:** painted field bow, study B. Its body, string, grip, and arrow must be
  rotated as one mechanically coherent assembly when shot direction changes.
- **Target hit:** clean concentric pulse, study A. The arrow tip sits about one
  eighth of its length behind the target perimeter. Exactly two softened rings
  expand into the space outside the target, with a narrow halo attached to each
  ring and no glow crossing onto the target face.
- **Arrow collision:** tapered twang, study B. The lodged arrow stays straight
  at its anchored third; its free tail makes one strong kick, a smaller
  overshoot, and settles in about 360 ms.

The comparative sources are [the target study](../visuals/bow/01-component-studies/target-study.svg),
[arrow study](../visuals/bow/01-component-studies/arrow-study.svg),
[bow study](../visuals/bow/01-component-studies/bow-study.svg),
[target-hit study](../visuals/bow/01-component-studies/target-impact-study.svg),
and [arrow-collision study](../visuals/bow/01-component-studies/arrow-collision-study.svg).

## Explored player draw state

[The formerly selected draw-state frame](../visuals/bow/02-player-draw/selected.png)
records the explored phone composition and geometry:

- The arrow aims up. The bow body runs horizontally, its center curves toward
  the shot direction, and the string pulls down.
- The grip runs horizontally with the bow body. Its identity insets are short
  vertical marks across the grip.
- All instructions and readouts occupy one compact band at the top, leaving the
  remaining screen to the bow and its draw gesture.
- The pull point uses exactly two concentric filled circles: a larger dark gray
  disc and a smaller lighter gray disc. It has no hand, white center, outline,
  glow, halo, ripple, or extra circle.
- A sparse cyan rail reports draw depth as measurement. Release readiness uses
  a warm signal color. The arrow's compact tail cap carries player identity.

The frame is a composition reference rather than final production artwork.
Implementation may simplify texture and shadow detail, but it must preserve the
silhouette, orientation, information placement, color semantics, and contact
marker described above.

### Direction feedback

The phone adds no protractor, sight gate, trajectory thread, or numeric angle
readout. Rotating the complete bow assembly gives immediate local direction
feedback. The player judges the resulting phantom trajectory against targets
and arrows on the shared board, where that spatial information is useful.

## Explored maximum tension and release

[The formerly selected nock-snap study](../visuals/bow/03-max-tension-release/selected.png)
kept this feedback at the player's pull point:

- At maximum tension, the cyan draw measurement reaches 100% and a compact
  tungsten or brass collar closes immediately outside the two gray contact
  circles. The collar is a tight mechanical detent, not a broad glow.
- On release, the two contact circles and readiness collar disappear in the
  first frame because the finger is no longer down.
- One small warm snap ring remains at the old nock position and fades quickly
  while a subtle doubled string position shows the string returning to rest.
- The arrow begins moving immediately. There is no trajectory, target, angle
  indicator, confetti, or field feedback on the phone during this response.
