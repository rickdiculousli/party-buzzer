# Poker animation implementation

The approved audit is `docs/audits/poker-animation/README.md`. Implement inline
in the current workspace, with one commit per major boundary. The user delegates
implementation choices and requests light validation grouped at boundaries.

1. **Animation lifetime:** retain deal/showdown paths by hand and dimensions;
   cache peek geometry and sleep its settled rAF; clean up transient timers and
   retired phone cards. Keep mount-only animations and deliberate match identity.
2. **Publication and clocks:** let definitions opt into a cheap semantic frame
   key. Poker publishes visible changes and rebased deadlines, with fresh frames
   on hello. Keep simulation steps unchanged. Animate shot rings locally and run
   HUD/tick clocks in small components independently of table updates.
3. **Painting:** separate moving card shadows and flips from inherited animated
   style variables; freeze chip lighting during travel, restore it on arrival;
   cache corral shading, omit hidden chip DOM, animate meter fills/glow with
   transforms/opacity. Preserve the felt's static texture unless evidence calls
   for replacing it. Add real-table/phone stress scenarios to the motion kit.
4. **Interpolation and finish:** simplify uploaded trajectories with bounded
   translation/rotation/lift/turn error and preserve phase/stacking landmarks.
   Update architecture/design guidance and record after measurements.

Checks: focused pure runtime/path tests, typecheck at commit boundaries; one full
suite and build at the end. Browser checks use the real motion components and
peek probes. No UI unit tests or repeated full coverage passes. Perform one final
code review. Device audio/gesture/multi-device checks remain manual.


Execution: completed inline on feat/poker. Checks were grouped per boundary as
requested. One fresh final review found per-segment z easing and clock-offset
rebasing issues; both were corrected with a focused real-component browser
check. Static felt/finite celebrations remain because no expensive invalidation
was demonstrated. No new dependencies or room mutations.
