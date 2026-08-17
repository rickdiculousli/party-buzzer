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

Each side nominates its own. Red splits two-two between Ada and Bo while Blue
settles on Eve, so Red holds both of the top spots on votes — and the seat
cannot take two from one team, so it reaches past Bo to Eve. That skip is the
thing to watch, and the two columns are what make it obvious.

- [ ] The standings switch to Red and Blue, and your phone shows its team colour
- [ ] Your nomination list is **your own team only** — no Blue name is on it,
      and the hint says your team picks its own
- [ ] Nobody who cannot be seated is on that list: join a second phone, leave it
      off both teams, and it appears on nobody's roster while being told it is
      not on a team yet
- [ ] The board is two columns, one per side, headed in the team's colour — an
      empty column stays up, so you can see which side has not decided
- [ ] The top of **each** column is railed brass. Bo is second in Red's column
      and dark, which is the seat reaching past him made visible
- [ ] `unvote:Gus` drops Eve to one, and the pair that gets seated changes with it
- [ ] Closing seats Ada and Eve; the host panel shows the pair and a Cancel
- [ ] Cy's press does nothing — he is Ada's teammate, not her second
- [ ] Eve answering wrong locks out **all of Blue**, not just Eve, and narrows
      the question to Ada alone
- [ ] Red's score moves, not Ada's

### The setlist — `npm run walk-flow`

Four players build a three-block setlist and play the first two: two trivia
questions, then two quizbowl questions each opened as a duel vote, then
`jump:0` puts the flow back at the top before the trailing trivia block is
ever reached. The point isn't any one buzz — it's the strip and the standings
surviving the mode switch, and the flow itself surviving a jump back to
block 1.

```bash
npm run walk-flow
```

- [ ] The host strip counts `Q1 of 2` → `Q2 of 2` and then rolls to block 2
- [ ] The scores from block 1 are **still there** after the mode switches
- [ ] Each question in the duel block opens its own nomination window
- [ ] `resetRound` (the host taking a question back) does not spend a question
- [ ] The board's chip tracks the strip and never grows past a chip
- [ ] Skip block jumps forward; the flow sits at "Flow complete" at the end
- [ ] Saving, clearing and loading the same flow returns the same blocks
- [ ] `clear` leaves the room with no flow

### Left over from either

- [ ] Both finalists missing says so on the board rather than reading "Buzz"
- [ ] `clear` leaves the room in solo mode with none of probe's players on it

## Reading

- [ ] Pack selected and rendered before guests arrive (first render is ~30s and
      caches; a re-read is instant)
- [ ] Mirror setting matches the game: off for quizbowl, on only if the room
      cannot see the board

### Spoken answers

- [ ] First boot with the judge: no `[stt]` warning; if a "Terminal wants
      Speech Recognition" dialog appeared, it was accepted once
- [ ] `npm run probe -- join:Ada,Bo act:selectPack:<pack> act:read wait:4000 buzz:Ada@0 'speak:Ada=<a real variant>'` — 200, transcript in brass on the board, points awarded
- [ ] Same with a wrong transcript — tally red, docked, rebound arms
- [ ] Real phone: join tap prompts for the mic once; lock in, hold to answer,
      release sends; the board shows what it heard within a second
- [ ] Drag down while holding cancels; nothing is sent, hold again to redo
- [ ] Drag-down cancel while a scrollable page could claim the gesture: pointercancel must not send a partial answer
- [ ] Answer window at 0: no countdown, and silence costs nothing until the
      host presses W
- [ ] Answer window at 5: say nothing — the lapse scores a wrong on its own
- [ ] Host W mid-answer: the judge's late verdict does not double-dock
- [ ] A machine mistake is one undo away: Z restores the pre-verdict state
