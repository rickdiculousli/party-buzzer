# Phone buzzer and vote rules

- The buzz is stamped with `now()` before any other work, so rendering never inflates the press time.
- The reaction row's local cooldown is the server's `REACT_COOLDOWN_MS` plus 250 ms. It dims whether or not the server kept the tap, so a dropped tap is never silent, and the margin stops a tap the instant the row relights from being refused on clock jitter.
- Every mood `phoneOf` returns has its own `.buzzer.is-*` selector, including an empty `is-waiting`, so a new mood without a rule is visibly missing.
- Someone else's verdict colours the name in the board hero's tone; identity colour stays off the letters and the edge, which carry state here (an identity red would read as a miss).
- The push-to-talk slab sets `touch-action: none`: a page scroll claiming the gesture mid-hold fires `pointercancel`, and `pointercancel` must never read as release, which sends.
- The no-mic slab has a dashed border, because a solid border on an inert surface reads as a button that stopped working.
- The duel panel is a lit panel, because for those seconds it is the only live control on the phone and loose buttons under a dead buzzer get scrolled past.
- A nominee button puts the name left and the vote figures right, so tallies line up in a comparable column. The nominee's identity rail is an inset shadow, not `border-left`, because `is-mine` recolours the border and identity must survive a vote. Your own vote is outlined, not filled, so a tungsten fill never sits under figures that must stay countable. The dial's identity rail is wider than a list row's so the well's side shadow gradient reads across it.
- A tally is one figure per vote (docs/design.md, "Votes"), keyed by the voter's id, not its index, so the arriving vote is the element that mounts and flares, and the rest stay still when someone takes a vote back.

Where: `client/Player.tsx` (`Player`: `buzz`, `reactWith`), `client/Votes.tsx` (`Votes`), `client/style.css` (`.buzzer`, `.buzzer.is-verdict`, `.buzzer--talk`, `.buzzer--say`, `.player__duel`, `.nom-btn`, `.dial__row`), `shared/wall.ts` (`phoneOf`, `Mood`)
