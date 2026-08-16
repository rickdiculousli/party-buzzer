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

Two paced walkthroughs, each one command that runs about a minute and puts the
room back afterwards. Every `wait` in them is a beat to look at all three
screens at once, so watch the board and the host panel with your phone in your
hand. Both end in a `clear`; if you stop one early, run `npm run probe -- clear`
yourself.

### The room votes — `npm run walk-duel`

Nine players nominate each other while you watch from a tenth phone. Join under
any name first; nobody in the script is you, so your buzzer and your vote are
yours to drive.

```bash
npm run walk-duel
```

The arc is three lead changes: Bo takes an early three, Fen catches him, then
two of Bo's backers cross to Gus and Bo drops out of contention entirely. His
last backer withdraws and he sits at zero with his name still on the board.
Gus then overtakes Fen outright. The seat goes to Gus and Fen; a spectator
presses and nothing happens; Fen answers wrong and Gus takes the rebound.

- [ ] Votes land one at a time on both the board and your phone, never in a lump
- [ ] The board's brass rail follows the lead as it changes hands
- [ ] Bo's tally counts **down** as backers leave, and his name stays at zero
      rather than vanishing
- [ ] You can vote from your phone and take it back by tapping the same name
- [ ] Your phone shows the seated pair, and says you sit this one out, before
      the host arms
- [ ] Arming opens only the finalists' buzzers — your press does nothing at
      all, not even a timeline mark
- [ ] A wrong answer hands the rebound to the other finalist alone, and the one
      who missed is dead-thumbed for the rest of the question

### Teams — `npm run walk-teams`

Eight players, four a side. **Join from your phone as Ada first** — probe
borrows the Ada already in the room rather than minting a second one, so your
phone is Red's finalist and the rebound is yours to press.

```bash
npm run walk-teams
```

Ada leads on three votes and her own teammate Bo is second on two — but the
seat cannot take two from one team, so it reaches past him to Eve. That skip is
the thing to watch.

- [ ] The standings switch to Red and Blue, and your phone shows its team colour
- [ ] Bo sits second on the board with **no** brass rail: the room is told who
      would actually be seated, not who is merely popular
- [ ] `unvote:Fen` drops Bo to one and the following vote puts him back to two,
      and he is skipped either way
- [ ] Closing seats Ada and Eve; the host panel shows the pair and a Cancel
- [ ] Cy's press does nothing — he is Ada's teammate, not her second
- [ ] Eve answering wrong locks out **all of Blue**, not just Eve, and narrows
      the question to Ada alone
- [ ] Red's score moves, not Ada's

### Left over from either

- [ ] Both finalists missing says so on the board rather than reading "Buzz"
- [ ] `clear` leaves the room in solo mode with none of probe's players on it

## Reading

- [ ] Pack selected and rendered before guests arrive (first render is ~30s and
      caches; a re-read is instant)
- [ ] Mirror setting matches the game: off for quizbowl, on only if the room
      cannot see the board
