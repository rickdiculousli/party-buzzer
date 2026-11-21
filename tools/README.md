# Tools

What each runnable tool is for and how to call it. This page is the tools' manual; `npm run probe` with no steps prints only a one-line summary.

## tools/probe.ts

A scripted round, for when you need one exact moment to happen on demand.

`sim.ts` plays a believable game, which is the right instrument for watching
the board over time and the wrong one for inspecting a single frame: you wait
on dice for the photo finish you wanted. Probe is the other half — you say
precisely who buzzed, how far behind, and what the host did next, and it
happens on the spot, the same way every time.

  npm run probe -- join:Ada,Bo arm buzz:Ada@40,Bo@45          a photo finish
  npm run probe -- arm                                        open the buzzers
  npm run probe -- clear                                      put the room back
  npm run anim                                                every anchor, on repeat

Steps run in order, left to right, and then the process exits — leaving the
board on whatever frame the last step produced. Nothing is being held up from
here: the screen is server state, so a one-shot command is enough to park the
room on an exact moment and walk away from it.

Probe's players carry ids like `probe-ada`, so running the same command
repeatedly resumes the same people instead of stacking up duplicates, and
`clear` can find them again later. Anyone who joined from a real phone is left
alone, and `buzz` only ever drives the script's own players.

Steps:
  join:A,B,C       connect players under those names
  value:400        set what the question is worth
  arm              open the buzzers (waits for ARMED before moving on)
  buzz:A@0,B@120   press, at that many ms after the buzzers open
  correct          award the leader
  wrong[:200]      dock the leader and lock them out, re-arming for a rebound
  next             clear the round
  reset | undo     reset the round / undo the last host action
  pack:name.txt    pick a pack and wait out its synthesis
  autoplay:on:4:2:12  autoplay on, payoff dwell, rebound pause, introduction (seconds)
  mirror:on        show question text and images on the phones too
  rewind           forget where every pack got to, so a walkthrough repeats exactly
  read             start the reader on the chosen pack or the block's
  armed            wait for the buzzers to open — the reader arms, not you
  done             wait for the reader to finish the pack
  mode:trivia      pin the mode (resets scores, as a host mode switch does)
  direct           drop any setlist — the one step that touches a setlist probe did not set
  act:name[:data]  host-scoped act (fragment / powerEnds / revealAnswer)
  speak:A=text     A's transcript, POSTed as text/plain into the judge
  say:A=words      the same, but spoken: `say` renders the words to a clip and
                   the clip goes in as audio, so STT and the matcher both run
  pick:A=C@1500    picks on a choice question, by letter, that many ms after
                   the choices go up (@0 by default); waits for it to settle
  guess:A=1700@800 numbers on a closest question, that many ms after guessing
                   opens (@0 by default); waits for it to settle
  teams:R=A,B/S=C  teams grouping, those teams, those players on them
  setlist:t*2@p.txt,q*1:v
                   setlist: mode*count blocks, @pack the reader takes that
                   block's questions from, a trailing :rule opens a duel for
                   the block it follows
  jump:1           jump the setlist to that block index
  duel:vote        open a heads-up duel under that rule id
  minigame:prepare[:secs]  open the current setlist block's minigame (or the one named); start | close
  ready            every joined player taps Ready in the open minigame lobby
  in:A,B | out:A   volunteer / back off, from those players' own sockets
  vote:A=B,C=B     A votes for B, C votes for B (`=`, not `>`: no quoting)
  react:A=ooh,B=legend
                   reactions from those players' phones (ooh, noway, tooslow,
                   legend); the hub keeps one per player per 3 s
  unvote:A         A takes their vote back — the tally counts down
  seat[:A,B]       close the window: resolve by rule, or seat those two
  cancel           call the duel off
  wait:1200        hold, in ms — the only step that exists for your eyes
  clear            put the room back: duel off, teams undone, players gone, the night forgotten
  loop             repeat the whole script until Ctrl-C

A note on pacing a `loop` script: to sit on the open buzzer before anyone
presses, push every offset out by that much (`buzz:Ada@1000,Bo@1250`) rather
than adding a `wait` after `arm`. The deltas the board draws are relative to
first place, so the timeline is identical either way — but a `wait` would let
all four packets arrive in the same tick, and the marks would appear at once
instead of landing one after another.

## tools/sim.ts

Synthetic self-play. Fills the room with bots that buzz like people so you can
watch the board and a phone across a real game — especially the timeline,
which only tells you anything once you have seen a photo finish and a
runaway question back to back.

It is an ordinary client: real sockets, real protocol, real clock sync. The
server has no idea these aren't people, so what you see on the board is what
a real room would produce.

  npm run sim                          against http://localhost:8080
  npm run sim -- 5                     stop after five questions
  npm run sim -- 5 2                   five questions, half speed, for watching
  npm run sim -- 5 1 http://box:8080   against another host
  npm run sim -- 5 1 --game quizbowl   switch the room's mode first

The env vars (ROUNDS, PACE, URL, GAME) still work; positional args win.
Ctrl-C removes the bots on the way out, so your real game is left clean.

## tools/sim-bow.ts

Synthetic self-play for the bow minigame. Fills the room with bots that draw,
aim and release like people, so you can watch the board through real matches:
crowded targets, arrows glancing off stuck shafts, and mid-air collisions.

Like `sim.ts` it is an ordinary client over real sockets. Bots aim by
rebuilding the seeded world from projected state (the same seed and
participants the server used), solving a shot to a target, then adding
their own aim error.

  npm run sim-bow                        endless 40-second matches
  npm run sim-bow -- 3                   stop after three matches
  npm run sim-bow -- 3 20                three 20-second matches
  npm run sim-bow -- 3 20 http://box:8080

Ctrl-C cancels the match and removes the bots, so your real game is left clean.

## tools/sim-ink.ts

Synthetic self-play for Phantom Ink. Eight bots join, crowd onto Sun until it
is over capacity, then two move to Moon, volunteer, and play until a team
wins or the pad fills. Each team has three Guessers: they tap the options they
are voting on, split their votes, drift toward the leading choice, and Force a stalled vote. Writers print a word
per clue in hand-drawn capitals, one letter to a slot, and a peek adds that row's next letter;
and a guessing bot spells half the word, misses its team's first guess and wins on the
second. A team with a borrowed phone types its own guesses; bots on it leave the keyboard alone.
Needs packs/phantom-ink.txt on the server; on a checkout without it, start the server
with INK_SAMPLE=1 to use the packs/ink-sample.txt deck.

  npm run sim-ink
  npm run sim-ink -- 2500                  one bot action every 2.5 s
  npm run sim-ink -- 2500 http://box:8080

Join a phone under a bot's name (Ivy, Jax, Kai, Lux, Mo, Rex, Sol, Tia) before running
to watch that bot's view; the bot plays for it. Ivy and Lux are the Writers. The log names
every role and prints the secret word, so a borrowed phone can spell its own guess.

Ctrl-C closes the minigame and removes the bots it created.

## tools/sim-poker.ts

Synthetic self-play for Poker. Six bots join and play a fast tournament to
one winner: small stacks, one-minute levels and a five-second shot clock.
Fay never acts until three are left, so the shot clock plays her hands; the
last three shove often so the match finishes. Folds send a flick, so the
board shows flights. Every betting beat checks that no chip appeared or
vanished.

  npm run sim-poker
  npm run sim-poker -- 300                  one bot look every 0.3 s
  npm run sim-poker -- 300 http://box:8080

Solo plays heads-up against you: join a phone first, then one bot (Ada) takes
the other seat at the default stack, blinds and 30-second shot clock, and
acts after about 1.5 s. Your phone is never kicked.

  npm run sim-poker -- solo
  npm run sim-poker -- solo 3000            Ada takes about 3 s per action

The match ends on its own; Ctrl-C stops it, clears the Poker session and its
checkpoint, and the bots leave.

## tools/sim-sketch.ts

Synthetic self-play for Sketch. Eight bots join and play one match: a drawer
picks a word and scribbles; guessers send wrong guesses, the odd close one,
and the right answer once their skill allows. Phones already in the room play
along. The log names each drawer and word.

  npm run sim-sketch
  npm run sim-sketch -- 400                  one bot action every 0.4 s
  npm run sim-sketch -- 400 http://box:8080

The match ends on its own; Ctrl-C ends it early. Either way the minigame
closes and the bots leave.

## tools/sim-tank.ts

Synthetic self-play for the tank minigame. Bots join, get paired into crews
by the server, and fight. Drivers work the dial like a person: point at a
heading, drive forward through the arc while the hull swings round, circle
the nearest enemy at mid range, back off when crowded, and steer around the
cover in front of them. Gunners select an absolute world heading and fire once
the slewing turret is actually lined up. Solo crews aim their fixed turret
with the hull.

Bots read the shared field through a board connection, like the TV does.

  npm run sim-tank                        endless 60-second matches
  npm run sim-tank -- 3 30                three 30-second matches
  npm run sim-tank -- 3 30 http://box:8080

Ctrl-C cancels the match and removes the bots.

## tools/sim-tug.ts

Synthetic self-play for the tug of war minigame. Fills the room with bots that
tap at personal rhythms (steady, masher, bursty, lazy), so you can watch the
rope on the board through real matches.

Like `sim.ts` it is an ordinary client over real sockets.

  npm run sim-tug                        endless 30-second matches
  npm run sim-tug -- 3                   stop after three matches
  npm run sim-tug -- 3 20                three 20-second matches
  npm run sim-tug -- 3 20 http://box:8080

Ctrl-C cancels the match and removes the bots, so your real game is left clean.

## tools/fakes.ts

Fake players with fake scores, for filling out the standings when you're
working on the board or the phone dial and don't want to run a whole sim.

  node tools/fakes.ts add [n]     join n fakes (default 8) with random scores
  node tools/fakes.ts remove      kick every fake
  URL=http://box:8080 node tools/fakes.ts add

IDs are pinned to fake-01..fake-99, so re-running `add` retargets the same
players instead of minting duplicates, and `remove` can never touch a real
player. The fakes disconnect when the tool exits; their roster entries and
scores stay until you remove them.

## tools/voice.ts

Hear the paid voice without starting the game.

  npm run voice -- quizbowl-lite.txt               what's new, what's cached, how long each runs
  npm run voice -- quizbowl-lite.txt --go          render the new lines (spends credits)
  npm run voice -- quizbowl-lite.txt --play        play the performed lines: S:, R: and the quip pools
  npm run voice -- "[snickers] Okay. [deadpan, quick] Absolutely not." --go --play
  npm run voice -- quizbowl-lite.txt --html        a workbench: listen, edit, nix, note, copy feedback

A pack's texts come from the reader itself (`textsOf`), and takes land in
the cache the game reads, keyed the same way. So a line rendered here is
already paid for when the game reaches it, and a line the game rendered
plays here for free. Nothing renders without `--go`.

## tools/trace.ts

The read half of the trace: diff the frames, print what moved.

## tools/demo-sounds.ts

Fills the sound library with something to actually pick from.

  npm run demo-sounds          # generate
  npm run demo-sounds clean    # take them all back out

The Library panel and the `+ layer` picker are both lists, and an empty list
teaches nothing: you cannot tell what auditioning is *for* until there are
six candidates and five of them are wrong. So this drops a believable holding
ground into `sounds/raw/` — deliberately messy names, the shape a real
afternoon of downloading leaves behind — plus two already-adopted files so
the picker has entries that are not the three anchor cues.

Everything is synthesized by ffmpeg from `lavfi` sources. Nothing is
downloaded, nothing is vendored, and no file here is a candidate for the real
board — they are shapes to look at in the editor and drag the ends of.

Limit: five raw files and two adopted, hard-coded. A generator with
parameters would be a synthesizer, and there is one of those in the browser
already.

## tools/loudness.ts

How loud each cue is, measured rather than guessed.

  npm run loudness           # every cue against the standard; fails if one is off
  npm run loudness -- --apply   # scale each off-standard cue's gains onto it

Renders each recipe offline the way `synth.ts` plays it (source → envelope →
biquad, WebAudio's own filter formulas), then K-weights it as BS.1770 does
and reports the loudest 100ms window in LUFS. 100ms rather than the
standard's 400ms because most cues are shorter than 400ms, and a window
longer than the sound averages silence into it.

Limit: oscillators are naive (not band-limited) and filters update once
per 128-sample block like WebAudio's k-rate path. Close enough to rank and
level cues to a dB or so; not a mastering meter.

## tools/poker-prints.ts

Regenerate local peek textures from PlayingCard, its stylesheet and local font.
Run `npm run poker:prints` after changing the artwork or card tokens.
The development-only print page is never a production build entry.

## tools/qa/kinematics.ts

Motion as numbers, for a critic who cannot watch it.

  node tools/qa/kinematics.ts            # every preset, 12 seeds each
  node tools/qa/kinematics.ts deal fold  # presets whose name contains a word

Runs the real path generators in `client/toss.ts` with fixed seeds and
reports each move in card widths (cw), so numbers compare with a real table:
a poker card is 6.3cm wide, so 1 m/s is about 16 cw/s. It also flags shapes
that real objects do not make (see `violations`). A flag is a lead, not a
verdict: a hand may legitimately push, and a clamp may be intended.

Limit: presets cover Poker's moves only. Add a preset when another game
builds motion from frame lists.

## tools/qa/sound.ts

What a cue sounds like, as numbers, for a critic who cannot hear it.

  node tools/qa/sound.ts               # every cue
  node tools/qa/sound.ts poker-deal    # cues whose name contains a word

Renders each recipe with `tools/loudness.ts` and reports:
- loudness against its tier in the standard;
- shape: onset, attack (to 90% of the envelope's peak), how long it lasts,
  and how much of that it spends within 10dB of its peak (`held`: a short
  hit is near 0; a held, steady noise is the TV-static shape);
- spectrum: energy share per band, centroid, and flatness (1 is white
  noise, near 0 a pure tone);
- `phone`: the share of energy above 400Hz, which is roughly what a phone
  speaker can play at all. Below about 30% a cue is mostly inaudible there.

## tools/qa/filmstrip.ts

A motion-harness scenario as a contact sheet, for a critic who cannot watch it.

  node tools/qa/filmstrip.ts --list
  node tools/qa/filmstrip.ts poker-deal                 # 12 frames across the move
  node tools/qa/filmstrip.ts poker-flop --frames 20 --out .qa/flop
  node tools/qa/filmstrip.ts poker-street --at 0,200,400,560,620,700

Starts its own Vite on a spare port, opens `anim.html` on the scenario in
headless Chromium, waits for the moment to mount, pauses every animation on
the stage and steps them all to each sample time on one shared clock, so a
frame is exactly what the room sees at that instant. Writes `sheet.png`
(frames left to right, top to bottom, each captioned with its time) and
`timing.json` (every animation's target, delay, duration and easing).

The harness stage is a patch of felt, not the whole board, and sound is not
captured. Timing, audio and touch feel still need a person.

