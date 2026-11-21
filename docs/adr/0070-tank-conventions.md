# Tank world conventions and fairness choices

- Angles are radians with 0 along +x, clockwise on screen. `hull`, `hullTarget` and `turretTarget` are absolute world headings; `turret` is relative to the hull.
- Spawn points come in point-symmetric pairs around the field centre, so no crew starts with a better position.
- Crews are reshuffled with `Math.random` on every start, while the map stays seeded so a replay gets the same cover.
- The hull swings slowly toward its target (`HULL_AIM_RADIANS_PER_SEC`) so a dial flick reads as steering, not a snap; this is a feel tunable.
- Deadlines compare with a `1e-6` tolerance because tick times are multiples of a repeating fraction.
- Projectiles sample the environment at most 4 px apart; projectile pairs use exact swept contact instead.
- An overlapping pair of tanks may still move apart, so a respawn on top of a tank never locks both.
- Board frames carry cover deltas, plus the whole grid every `FULL_COVER_EVERY_TICKS`, so a board that joins late or drops a frame resyncs.
- The phone controller always renders in landscape with the phone's left edge down, whatever way the screen autorotates; a CSS rotation compensates for the current screen angle and viewport shape, recomputed on resize and orientation change.

Where: `server/minigames/tank/types.ts` (`Tank`, `TankWorld`), `server/minigames/tank/cover.ts` (`SPAWNS`), `server/minigames/tank/definition.ts` (`create`, `boardFrame`), `server/minigames/tank/world.ts` (`reached`, `HULL_AIM_RADIANS_PER_SEC`, `blocked`), `client/tank-control.ts` (`tankViewRotation`), `client/useSideways.ts` (`useSideways`, `sidewaysClass`)
