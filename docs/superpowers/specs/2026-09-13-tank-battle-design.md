# Tank battle minigame — design

Date: 2026-09-13

Tank battle is the second minigame. Players are paired into two-person crews:
a driver steers and moves the hull, and a gunner turns the turret and fires.
Both turn their part by spinning a crank wheel on the phone. The turret turns
with the hull, so a crew must coordinate to aim.

Tank also forces the minigame registry described in
[the minigames design](2026-09-06-minigames-design.md). Today
`server/minigames/runtime.ts` and the protocol are bow-specific.

Mechanics come first with placeholder shapes, as for bow.

## Decisions

- Timed free-for-all. Destroyed tanks respawn; nobody sits out.
- Crews are random pairs made at **Prepare**, with random roles. An odd player
  out gets a solo tank and a phone showing both control panels. Replay
  reshuffles.
- A wheel's rotation maps to heading at a fixed gear ratio with no rate cap.
  Wheels spin endlessly.
- The turret angle is relative to the hull.
- The gunner has two fire buttons: hold Gun for automatic fire, tap Cannon.
- Cover is destructible. Every projectile explodes and carves cover; only the
  cannon's blast damages tanks.
- Bow moves behind a registry; tank is the second entry. No copied runtime.

## Match rules

All numbers are tunable defaults in the tank world config.

### Field

The field is 1600×900, like bow, with indestructible edge walls. Cover is a
160×90 grid of 10 px cells. The seed places a few block clusters and keeps
the spawn corners clear. Spawn points are symmetric around the field.

### Tanks

- Hull 50×34, 100 HP.
- Forward 160 px/s, backward 100 px/s, only while the driver holds a button.
- One full wheel turn rotates the hull or turret 90°. Heading changes only
  while the wheel spins.
- Gun world direction is hull heading plus turret angle. When the hull turns,
  the gun swings with it.
- A tank is stopped by cover cells, edge walls, and other tanks.

### Weapons

Both fire along the gun's world direction. Projectiles travel; they are not
hitscan.

| | Gun | Cannon |
|---|---|---|
| Direct hit damage | 5 | 30 |
| Clip | 20 | 1 |
| Fire rate | 10 rounds/s while held | one per tap |
| Reload | 2 s once empty | 3 s after each shot |
| Blast radius | 8 px, carves cover only | 40 px, carves cover and splashes |

Cannon splash falls off linearly from 20 at the blast center to 0 at the
radius and includes the firing tank. A direct hit does not also take splash.
A projectile explodes on its first contact with a tank, cover cell, or edge
wall, or at the end of its lifetime.

### Death, respawn, scoring

- At 0 HP a tank is destroyed and respawns after 3 s at the free spawn point
  farthest from enemies, with 2 s of invulnerability.
- A crew earns 1 point per damage dealt to other tanks and 50 per kill.
  Self-damage earns nothing.
- Both crew members receive the crew total, committed to the party scores when
  the match ends through the existing result commit.

## Architecture

### Registry

`server/minigames/registry.ts` maps `bow` and `tank` to a
`MinigameDefinition`:

- option defaults and sanitizing;
- world creation from seed and participants (tank also builds crews);
- input validation and application;
- one fixed step;
- board and player frame projections;
- results.

`runtime.ts` keeps lifecycle, clocks, catch-up limits, the input grace
window, sequence tracking, dispositions, and acks, and calls the definition
for everything else. Bow behavior does not change; its existing tests must
pass through the registry.

The client selects player and board renderers from static maps keyed by
minigame id. The host's Prepare control gains the tank choice.

### Session state

The minigame session gains `crews: { id, driver, gunner }[]` for tank. A solo
crew uses the same player id for both roles.

### Wire

`BowInputMsg` becomes `minigameInput { matchId, seq, input }` with a per-game
input union.

- Driver: `{ kind: 'wheel', turns }`, `{ kind: 'drive', dir: -1 | 0 | 1 }`.
- Gunner: `{ kind: 'wheel', turns }`,
  `{ kind: 'trigger', weapon: 'gun' | 'cannon', down }`.
- A solo crew's wheel input adds `part: 'hull' | 'turret'`.

`turns` is a delta, not an absolute angle, so a dropped or coalesced packet
does not lose rotation and endless spinning never grows a number. Wheel
deltas sum between steps; the latest drive and trigger state wins. Trigger
presses receive acks like bow releases. Inputs follow the existing lifecycle
and grace rules.

### Frames

- Board: tanks (position, hull angle, turret angle, HP, respawn state and
  countdown, invulnerability), projectiles, blasts from the last step, and
  cover cells changed that step as indices. The full cover grid is sent at
  countdown and whenever a board connects.
- Player: own crew's HP, respawn state, gun clip count, and reload progress
  for each weapon.

## Client

### Wheel

- A large wheel with spokes and a knob on the rim, like a real crank handle.
  The drawing rotates with the finger, so the knob shows how far and which way
  it has turned.
- While a finger is down, the phone tracks the pointer angle around the wheel
  center and accumulates the unwrapped change across the ±180° seam.
- Accumulated turns are sent about every 33 ms, then reset.
- A light 5 ms buzz ticks every eighth of a turn where `navigator.vibrate`
  exists.

### Buttons

Buttons act on pointer down and up, so one thumb can hold a button while the
other turns the wheel.

- Driver: big Forward and Back hold buttons.
- Gunner: big Gun (hold) and Cannon (tap) buttons.
  - Each weapon button shows its ammo as a fraction inside: `14/20`, `1/1`.
  - An empty weapon shades its button in the grey family.
  - While reloading, a shaded bar fills across the button until it is ready.
- A solo crew stacks both panels.

### Board

Cover draws on a `<canvas>` at the fixed 1600×900 field size and redraws only
changed cells. Tanks, HP bars, projectiles, and blasts are SVG layered on top
with the same viewBox scaling as bow. Each tank shows a gun aim line along its
world gun direction that fades from full opacity to zero over about 400 px.

## Testing

- Tank world unit tests: turret swings with the hull; wheel turns to degrees;
  gun fire rate, clip, and reload; cannon reload; projectile against tank,
  cover, and edge; blast carving; splash falloff and self-damage; tank blocked
  by cover and other tanks; respawn and invulnerability; scoring.
- Runtime: bow's existing runtime tests pass through the registry; a tank
  match runs start to results.
- Client: wheel angle unwrapping.
- `npm run sim-tank`: bot crews in the live room. Drivers head toward the
  nearest enemy, gunners spin toward it and fire when roughly aligned.

## Out of scope

- Setlist tank blocks, as for bow.
- Final visual style.
- Team scoring through the existing `teams` grouping; crews are
  per-match only.
