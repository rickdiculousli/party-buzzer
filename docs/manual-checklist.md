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

### The setlist — `npm run walk-setlist`

Four players build a three-block setlist and play the first two: two trivia
questions, then two quizbowl questions each opened as a duel vote, then
`jump:0` puts the setlist back at the top before the trailing trivia block is
ever reached. The point isn't any one buzz — it's the strip and the standings
surviving the mode switch, and the setlist itself surviving a jump back to
block 1.

```bash
npm run walk-setlist
```

- [ ] The host strip counts `Q1 of 2` → `Q2 of 2` and then rolls to block 2
- [ ] The scores from block 1 are **still there** after the mode switches
- [ ] Each question in the duel block opens its own nomination window
- [ ] `resetRound` (the host taking a question back) does not spend a question
- [ ] The board's chip tracks the strip and never grows past a chip
- [ ] Skip block jumps forward; the setlist sits at "Setlist complete" at the end
- [ ] Saving, clearing and loading the same setlist returns the same blocks
- [ ] `clear` leaves the room with no setlist

### Reading itself — `npm run walk-read`

Three players, one pack (`packs/walk-c.txt`), autoplay on. Nobody presses N and
nobody judges: every answer is **spoken out loud** and scored by the judge, so
this is the one walkthrough that exercises `say` → STT → the fuzzy matcher end
to end. Roughly a minute and a half.

Answers are rendered by `say` in a voice of its own and cached beside the
reader's clips, so the first run pays for three short clips and every run after
posts files that are already there.

```bash
npm run walk-read
```

**It needs the judge.** No `swiftc`, no `server/stt/stt.swift`, and no window
ever opens — the run stops on "no answer window for Ada" rather than hanging.

- [ ] The voice **stops mid-word** on the buzz — no trailing syllable, and the
      rest of that clue is never read after the correct answer
- [ ] Ada says "the Pacific Ocean" — a whole phrase, in a different voice from
      the reader's. The board shows what it heard, in brass, and scores it
- [ ] The payoff sits for four seconds and the next question arms itself
- [ ] Bo answers "Rosalind Franklin" on the Curie question. The transcript goes
      up in red and the matcher refuses it — the machine is doing the judging
- [ ] After that wrong answer the miss holds the wall — red name, red stamp, no
      filament, no value — with **the buzzers shut** for three seconds. Nothing
      opens on the verdict itself
- [ ] During that hold the host's Correct button reads **Reopen now**. Pressing
      it (or R, or C) opens the rebound early; leaving it alone lets the reader
      open it on its own beat, exactly as before
- [ ] Cy's answer is judgeable **by hand** — C and W are live on the retake even
      though Bo's −300 is still on State. Judging it with the mouse scores the
      same as letting the machine do it
- [ ] Then the filament runs, and the clue picks back up from the start of the
      fragment the buzz cut *as* the buzzers open, not seconds after
- [ ] Cy lets **two more sentences** go by before buzzing, and says "Marie
      Curie". That gap is the point: a rebound is a live question again, not a
      handover
- [ ] Bo's red transcript is up for the whole hold and **comes down as the
      buzzers open** — the clue resumes on a clean wall, not underneath it
- [ ] The clue does **not** flash back onto the stage while a transcript is
      typing. Bo's name holds the middle from his buzz through to his stamp,
      one continuous thing
- [ ] Cy buzzing takes Bo's −300 stamp down with it, the same way it takes the
      red transcript down. Nothing of the miss is left above Cy's name
- [ ] Nobody buzzes the third question: it reveals its answer and passes
- [ ] The pack runs out, **autoplay switches itself off**, and the room is left
      playable by hand
- [ ] Scores end Ada 200, Bo −300, Cy 300 — the same three numbers every run.
      Different numbers with the same words spoken means STT drifted, and the
      transcripts on the board say which one

### Two packs in one setlist — `npm run walk-packs`

Five questions across three blocks and two packs: trivia from A, two quizbowl
from B, then back to A. Nothing is read twice.

```bash
npm run walk-packs
```

- [ ] The mode changes at each block boundary and the standings survive it
- [ ] The pack changes with it, and there is **no pause at the boundary** — both
      were synthesised before question one
- [ ] Block 3 returns to pack A and continues it: question two, not question one
- [ ] The setlist ends, the reader stops, and `clear` leaves no setlist and no
      players behind
- [ ] Run it twice back to back. The second run is identical to the first —
      that is `rewind` doing its job

### Left over from either

- [ ] Both finalists missing says so on the board rather than reading "Buzz"
- [ ] `clear` leaves the room in solo mode with none of probe's players on it

## Reading

- [ ] Pack selected and rendered before guests arrive (first render is ~30s and
      caches; a re-read is instant)
- [ ] Mirror setting matches the game — off for quizbowl, on only if the room
      cannot see the board
- [ ] A buzz cuts the voice mid-word — no trailing syllable, and the rest of the
      clue is not read after a correct answer
- [ ] A wrong answer re-reads the fragment the buzz cut, from its start
- [ ] Autoplay on: the answer sits for the dwell you set and the next question
      arms with nobody touching the keyboard
- [ ] Autoplay on: a question nobody buzzes passes itself rather than hanging
- [ ] Autoplay on: the rebound pause is long enough to call the miss out loud
      before the voice starts again, and the buzzers stay shut for all of it —
      a phone tapped during the miss gets nothing
- [ ] Autoplay **off** (or reading by hand): a wrong answer still rebounds
      instantly, the way it always did. The hold is the reader's, not the rule
- [ ] Autoplay off: nothing advances without your N — the check that the dwells
      cannot leak into a hand-driven game
- [ ] The pack running out switches autoplay off by itself, and the room still
      plays by hand from there
- [ ] A block asking for more questions than its pack holds says so in amber on
      that block, and is still allowed to be built
- [ ] Setup offers Direct play or Setlist and never both sets of controls: no
      Game or Pack picker under a setlist, no Setlist panel under direct play
- [ ] A setlist whose blocks name two different packs reads each from its own,
      with no pause at the boundary — both were rendered before question one
- [ ] A block returning to an earlier pack continues it rather than restarting
- [ ] A block naming no pack stops the reading and hands you the question

### Spoken answers

- [ ] First boot with the judge: no `[stt]` warning; if a "Terminal wants
      Speech Recognition" dialog appeared, it was accepted once
- [ ] `npm run probe -- join:Ada,Bo act:selectPack:<pack> act:read wait:4000 buzz:Ada@0 'speak:Ada=<a real variant>'` — 200, transcript in brass on the board, points awarded
- [ ] Same with a wrong transcript — tally red, docked, rebound arms
- [ ] The banner's join URL is the `local-ip.sh` name, and a phone opens it with
      no certificate warning — a warning screen means the wildcard lapsed
- [ ] Real phone: join tap prompts for the mic once; lock in, hold to answer,
      release sends; the board shows what it heard within a second
- [ ] **No prompt at all means no secure context** — check the phone is on the
      `local-ip.sh` url and not the raw IP. On http the talk button is replaced
      by "Say it out loud", which is the correct fallback, not a bug
- [ ] Kill the wifi's internet and reboot the server with `.cert/` deleted: it
      says it is serving http without a mic, and the room still plays
- [ ] Drag down while holding cancels; nothing is sent, hold again to redo
- [ ] Drag-down cancel while a scrollable page could claim the gesture: pointercancel must not send a partial answer
- [ ] Answer window at 0: no countdown, and silence costs nothing until the
      host presses W
- [ ] Answer window at 5: say nothing — the lapse scores a wrong on its own
- [ ] Host W mid-answer: the judge's late verdict does not double-dock
- [ ] A machine mistake is one undo away: Z restores the pre-verdict state
