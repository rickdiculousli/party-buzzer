# Manual checklist

Automated tests cover buzz ordering, the timestamp clamp, and reconnection.
These need real hardware — run them once before a real game night.

## Per phone (test at least one iPhone and one Android)

- [ ] Scanning the QR from the camera app opens the join page
- [ ] Scanning the QR shown on `/board` works from across the room
- [ ] After joining, the buzzer fills the screen with no scroll or bounce
- [ ] Pressing the buzzer vibrates
- [ ] Pressing the buzzer makes a sound — **the iOS case**: audio must work on
      the first buzz of the night, proving the join tap unlocked the audio
      context
- [ ] The screen does not dim or sleep while the buzzer page is open
- [ ] Locking and unlocking the phone returns to a working buzzer within a
      second or two
- [ ] Walking out of WiFi range and back reconnects automatically, keeping the
      same name and score
- [ ] Reloading the page keeps the same identity
- [ ] "Add to Home Screen" produces a working full-screen app

## Room

- [ ] `/board` is readable from the far side of the room
- [ ] Ten or more phones joined at once, all appearing on the host panel
- [ ] Two players buzzing near-simultaneously produce a plausible winner and a
      believable millisecond gap
- [ ] Host laptop sleeping and waking does not lose scores

## Duels

Join from your phone as Ada first, then run one paced pass. Every `wait` is a
beat to look at all three screens; probe borrows the Ada already in the room
rather than minting a second one, so your phone is one of the finalists.

```bash
npm run probe -- join:Ada,Bo,Cy,Dee duel:vote wait:4000 \
  vote:Bo=Ada,Cy=Ada,Dee=Bo wait:3000 unvote:Cy wait:3000 \
  seat wait:3000 arm buzz:Cy@0 wait:2500 buzz:Bo@120 wrong:0 wait:3000 \
  buzz:Ada@80 correct
npm run probe -- clear
```

- [ ] The pool builds on the phone and the board as the votes land, one at a time
- [ ] `unvote:Cy` counts Ada's tally back down and leaves her name in place
- [ ] Your own vote is reversible: tap the name you backed a second time
- [ ] Closing seats two finalists; the host panel shows the pair and a Cancel
- [ ] Arming opens only the finalists' buzzers — a spectator's press does
      nothing at all, not even a timeline mark
- [ ] A wrong answer hands the rebound to the other finalist alone, and the
      one who missed is dead-thumbed for the rest of the question
- [ ] Both finalists missing says so on the board rather than reading "Buzz"

## Reading

- [ ] Pack selected and rendered before guests arrive (first render is ~30s and
      caches; a re-read is instant)
- [ ] Mirror setting matches the game: off for quizbowl, on only if the room
      cannot see the board
